import { dispatchApi } from './api'
import type { ModuleRecord } from './registry'
import { useUi } from '@/stores/ui'
import { eventBus } from './eventBus'
import { canExternalEmit, canExternalSubscribe } from './securityPolicy'
import { cleanupSandboxResources } from './sandboxCleanup'

/** 沙箱内运行的引导脚本：host 代理 + 事件桥 + RPC */
const BOOTSTRAP = `
(function(){
  var TOKEN = null, seq = 1, pending = {}, listeners = {};
  function rpc(method, params){
    return new Promise(function(resolve, reject){
      var id = seq++;
      pending[id] = {resolve: resolve, reject: reject};
      parent.postMessage({type:'rpc', id:id, method:method, params:params||{}, token:TOKEN}, '*');
    });
  }
  function mk(path){
    return new Proxy(function(){}, {
      get: function(t, prop){ return mk(path + '.' + String(prop)); },
      apply: function(t, thisArg, args){ return rpc(path, args[0] || {}); }
    });
  }
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 'init') {
      TOKEN = d.token;
      window.__manifest = d.manifest;
      window.dispatchEvent(new CustomEvent('host-ready', {detail: d}));
    } else if (d.type === 'rpc-res') {
      var p = pending[d.id];
      if (p) { delete pending[d.id]; d.ok ? p.resolve(d.result) : p.reject(new Error(d.error || 'RPC错误')); }
    } else if (d.type === 'event') {
      (listeners[d.name] || []).forEach(function(fn){ try { fn(d.payload); } catch(err) { console.error(err); } });
    }
  });
  window.events = {
    on: function(name, fn){ var list = listeners[name] = listeners[name]||[]; if (list.indexOf(fn) < 0) list.push(fn); parent.postMessage({type:'events-subscribe', name:name, token:TOKEN}, '*'); },
    off: function(name, fn){ listeners[name] = (listeners[name]||[]).filter(function(f){ return f !== fn; }); if (!listeners[name].length) parent.postMessage({type:'events-unsubscribe', name:name, token:TOKEN}, '*'); },
    emit: function(name, payload){ parent.postMessage({type:'events-emit', name:name, payload:payload, token:TOKEN}, '*'); }
  };
  window.host = new Proxy(function(){}, {
    get: function(t, prop){
      if (prop === 'events') return window.events;
      if (prop === 'manifest') return window.__manifest;
      if (prop === 'requestPermission') return function(params){ return rpc('request.permission', params || {}); };
      if (prop === 'capabilities') return { describe: function(){ return rpc('capabilities.describe', {}); } };
      return mk(String(prop));
    }
  });
  parent.postMessage({type:'hello'}, '*');
})();`

function buildDoc(entryCode: string): string {
  const safe = entryCode.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 12px; font: 13px/1.6 -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; color: #e6e9f2; background: transparent; }
  button { background:#2a3145; color:#e6e9f2; border:1px solid #3a4361; border-radius:6px; padding:6px 12px; cursor:pointer; font-size:13px; }
  button:hover { background:#35405c; }
  input, textarea, select { background:#161a23; border:1px solid #2a3145; color:#e6e9f2; border-radius:6px; padding:6px 8px; font-size:13px; }
  .card { background:#1b202e; border:1px solid #2a3145; border-radius:10px; padding:10px; margin-bottom:8px; }
  .dim { color:#9aa3b8; }
</style></head><body>
<script>${BOOTSTRAP}</script>
<script>${safe}</script>
</body></html>`
}

/** 生成模块沙箱 iframe 的 srcdoc（含模块入口代码） */
export function buildSandboxDoc(mod: ModuleRecord): string | null {
  if (!mod.files) return null
  const entry = mod.files[mod.manifest.entry]
  if (!entry) {
    useUi.getState().toast(`模块 ${mod.manifest.name} 缺少入口文件 ${mod.manifest.entry}`, 'error')
    return null
  }
  return buildDoc(entry)
}

/** 挂载沙箱 iframe 并处理 RPC（父端） */
export function attachSandboxHandlers(
  iframe: HTMLIFrameElement,
  mod: ModuleRecord,
  onError?: (e: string) => void
): () => void {
  const token = 'tk_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
  const subscriptions = new Set<string>()
  const busUnsubs = new Map<string, () => void>()
  const requests = new Map<number, AbortController>()
  let ready = false
  let active = true

  const forward = (name: string) => (payload: unknown) => {
    iframe.contentWindow?.postMessage({ type: 'event', name, payload }, '*')
  }

  const onMessage = async (ev: MessageEvent) => {
    if (!active) return
    if (ev.source !== iframe.contentWindow || !ev.source) return
    if (ev.origin !== 'null') return
    const d = ev.data as Record<string, unknown>
    if (!d || typeof d !== 'object') return
    if (d.type === 'hello') {
      ready = true
      iframe.contentWindow?.postMessage(
        { type: 'init', token, manifest: { ...mod.manifest, files: undefined } },
        '*'
      )
      return
    }
    if (!ready) return
    if (d.type === 'rpc' && d.token === token) {
      if (!Number.isSafeInteger(d.id) || typeof d.method !== 'string' || d.method.length > 120) return
      if (!d.params || typeof d.params !== 'object' || Array.isArray(d.params)) return
      let encoded: string
      try {
        encoded = JSON.stringify(d.params)
      } catch {
        return
      }
      if (encoded.length > 65_536) {
        ev.source.postMessage({ type: 'rpc-res', id: d.id, ok: false, error: 'RPC 参数超过 64 KB' }, '*')
        return
      }
      const controller = new AbortController()
      requests.set(d.id as number, controller)
      try {
        const result = await dispatchApi(mod, d.method, d.params as Record<string, unknown>, (name, payload) => {
          if (active && !controller.signal.aborted) iframe.contentWindow?.postMessage({ type: 'event', name, payload }, '*')
        }, controller.signal)
        if (active && !controller.signal.aborted) ev.source.postMessage({ type: 'rpc-res', id: d.id, ok: true, result }, '*')
      } catch (err) {
        if (active && !controller.signal.aborted) ev.source.postMessage({ type: 'rpc-res', id: d.id, ok: false, error: String((err as Error).message || err) }, '*')
        if ((err as Error).name === 'EPERMISSION') onError?.((err as Error).message)
      } finally {
        requests.delete(d.id as number)
      }
    } else if (d.type === 'events-subscribe' && d.token === token) {
      const name = String(d.name)
      if (canExternalSubscribe(name) && !subscriptions.has(name)) {
        subscriptions.add(name)
        busUnsubs.set(name, eventBus.on(name, forward(name)))
      }
    } else if (d.type === 'events-unsubscribe' && d.token === token) {
      const name = String(d.name)
      if (subscriptions.delete(name)) {
        busUnsubs.get(name)?.()
        busUnsubs.delete(name)
      }
    } else if (d.type === 'events-emit' && d.token === token) {
      const name = String(d.name)
      try {
        if (canExternalEmit(name) && JSON.stringify(d.payload ?? null).length <= 32_768) {
          eventBus.emit(name, d.payload)
        }
      } catch {
        onError?.('事件载荷必须是可序列化且小于 32 KB 的数据')
      }
    }
  }
  window.addEventListener('message', onMessage)
  return () => {
    cleanupSandboxResources({
      deactivate: () => { active = false },
      removeMessageListener: () => window.removeEventListener('message', onMessage),
      requests,
      busUnsubs
    })
  }
}
