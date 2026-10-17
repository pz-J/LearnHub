import { lh, uid } from '@/lib/ipc'
import { aiChat, aiAbort } from '@/lib/ai'
import { useTodos } from '@/stores/todos'
import { useSchedule } from '@/stores/schedule'
import { useNotes } from '@/stores/notes'
import { useFlashcards } from '@/stores/flashcards'
import { useModuleEvents } from '@/stores/misc'
import { usePapers } from '@/stores/papers'
import { useAchievements } from '@/stores/achievements'
import { useReaderState } from '@/stores/readerState'
import { useUi } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { eventBus } from './eventBus'
import { useGrants } from './grants'
import { CATALOG, isCapability, type Capability } from './permissions'
import { metaEscalate } from './metaCore'
import type { ModuleManifest } from './manifest'
import { useRegistry, type ModuleRecord } from './registry'
import { isAllowedExternalUrl, isAllowedNetworkUrl, isCapabilityAllowed } from './securityPolicy'

export class PermError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'EPERMISSION'
  }
}

function requirePerm(mod: ModuleRecord, cap: Capability): void {
  const granted = useGrants.getState().grants[mod.id] ?? []
  if (!isCapabilityAllowed(mod.manifest, cap, granted)) {
    throw new PermError(`模块 ${mod.manifest.name} 没有「${cap}」权限（可在模块中心查看授权）`)
  }
}

function checkHost(mod: ModuleRecord, url: string): void {
  const hosts = mod.manifest.network?.allowedHosts ?? []
  if (!isAllowedNetworkUrl(url, hosts)) throw new PermError('network.fetch 仅允许不含凭据的 HTTPS URL，且域名必须匹配模块白名单')
}

function registry(): NonNullable<ReturnType<typeof useRegistry.getState>['modules']> {
  return useRegistry.getState().modules
}

/** 内核统一 API 分发：所有模块（内置 + 沙箱）的宿主调用都经过这里做权限门禁。
 *  emit: 沙箱模块由此接收事件流（如 AI 流式块）；内置模块不传。 */
export async function dispatchApi(
  mod: ModuleRecord,
  method: string,
  params: Record<string, unknown>,
  emit?: (name: string, payload: unknown) => void,
  signal?: AbortSignal
): Promise<unknown> {
  if (signal?.aborted) {
    const error = new Error('模块请求已取消')
    error.name = 'AbortError'
    throw error
  }
  const p = params ?? {}
  switch (method) {
    // ---------- 私有存储 ----------
    case 'storage.get': {
      requirePerm(mod, 'storage.own')
      return lh.modStorageRead(mod.id)
    }
    case 'storage.set': {
      requirePerm(mod, 'storage.own')
      return lh.modStorageWrite(mod.id, p.obj ?? {})
    }
    case 'storage.clear': {
      requirePerm(mod, 'storage.own')
      return lh.modStorageWrite(mod.id, {})
    }

    // ---------- 能力目录自检（宿主内置 API，无需权限） ----------
    case 'capabilities.describe': {
      return Object.entries(CATALOG).map(([k, v]) => ({ id: k, ...v }))
    }

    // ---------- 学习数据 ----------
    case 'data.todos.list': {
      requirePerm(mod, 'storage.data')
      return useTodos.getState().items
    }
    case 'data.todos.add': {
      requirePerm(mod, 'storage.data')
      return useTodos.getState().add((p.todo ?? {}) as never)
    }
    case 'data.todos.update': {
      requirePerm(mod, 'storage.data')
      return useTodos.getState().update(String(p.id), (p.patch ?? {}) as never)
    }
    case 'data.todos.remove': {
      requirePerm(mod, 'storage.data')
      return useTodos.getState().remove(String(p.id))
    }
    case 'data.schedule.get': {
      requirePerm(mod, 'storage.data')
      return useSchedule.getState().schedule
    }
    case 'data.notes.list': {
      requirePerm(mod, 'storage.data')
      return useNotes.getState().listFor(p.paperId ? String(p.paperId) : undefined)
    }
    case 'data.notes.write': {
      requirePerm(mod, 'storage.data')
      return useNotes.getState().write(p.id ? String(p.id) : null, (p.patch ?? {}) as never)
    }
    case 'data.notes.remove': {
      requirePerm(mod, 'storage.data')
      return useNotes.getState().remove(String(p.id))
    }
    case 'data.flashcards.list': {
      requirePerm(mod, 'storage.data')
      return useFlashcards.getState().items
    }
    case 'data.flashcards.add': {
      requirePerm(mod, 'storage.data')
      return useFlashcards.getState().add((p.card ?? {}) as never)
    }
    case 'data.flashcards.update': {
      requirePerm(mod, 'storage.data')
      return useFlashcards.getState().update(String(p.id), (p.patch ?? {}) as never)
    }
    case 'data.flashcards.remove': {
      requirePerm(mod, 'storage.data')
      return useFlashcards.getState().remove(String(p.id))
    }
    case 'data.papers.list': {
      requirePerm(mod, 'storage.data')
      const { papers, order } = usePapers.getState()
      return order.map((id) => papers[id]).filter(Boolean)
    }
    case 'data.papers.get': {
      requirePerm(mod, 'storage.data')
      return usePapers.getState().get(String(p.paperId ?? ''))
    }
    case 'data.papers.update': {
      requirePerm(mod, 'storage.data')
      return usePapers.getState().update(String(p.paperId), (p.patch ?? {}) as never)
    }

    case 'achievements.award': {
      requirePerm(mod, 'achievements.award')
      const title = String(p.title ?? '').trim().slice(0, 80) || mod.manifest.name
      return useAchievements.getState().addModuleTask(mod.id, String(p.taskId ?? uid('mt_')).slice(0, 60), title)
    }

    // ---------- AI ----------
    case 'ai.chat': {
      requirePerm(mod, 'ai.invoke')
      const messages = (p.messages ?? []) as { role: string; content: string }[]
      let text = ''
      const reqId = String(p.reqId ?? '')
      const { done } = aiChat({
        messages: messages as never,
        temperature: typeof p.temperature === 'number' ? p.temperature : 0.4,
        signal,
        onChunk: (d) => {
          text += d
          emit?.('ai:chunk', { reqId, delta: d })
        }
      })
      await done
      return text
    }

    // ---------- 网络 ----------
    case 'network.fetch': {
      requirePerm(mod, 'network.fetch')
      const url = String(p.url ?? '')
      checkHost(mod, url)
      const init = (p.init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string }
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        body: init.body ? String(init.body) : undefined,
        // Prevent an allowlisted endpoint from redirecting requests to another host.
        redirect: 'error',
        signal: requestSignal
      })
      if (!res.body) return { status: res.status, text: '' }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > 1024 * 1024) {
          await reader.cancel()
          throw new Error('network.fetch 响应超过 1 MB 上限')
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return { status: res.status, text: new TextDecoder().decode(bytes) }
    }

    case 'links.open': {
      requirePerm(mod, 'links.open')
      const url = String(p.url ?? '')
      if (!isAllowedExternalUrl(url)) throw new PermError('links.open 仅允许不含凭据的 HTTPS 链接')
      // The main process re-checks the module manifest and persisted grant independently.
      return lh.moduleOpenExternal(mod.id, url)
    }

    // ---------- 日历 ----------
    case 'calendar.addEvents': {
      requirePerm(mod, 'calendar.write')
      return useModuleEvents.getState().addFor(mod.id, (p.events ?? []) as never)
    }
    case 'calendar.removeEvents': {
      requirePerm(mod, 'calendar.write')
      return useModuleEvents.getState().removeFor(mod.id, (p.filter ?? {}) as never)
    }

    // ---------- 阅读器 ----------
    case 'reader.getSelection': {
      requirePerm(mod, 'reader.annotate')
      return useReaderState.getState().selection
    }
    case 'reader.addHighlight': {
      requirePerm(mod, 'reader.annotate')
      return usePapers.getState().addHighlight(String(p.paperId), p.highlight as never)
    }
    case 'reader.openPaper': {
      requirePerm(mod, 'reader.annotate')
      useUi.getState().openPaper(String(p.paperId))
      return true
    }
    case 'reader.registerToolbarButton': {
      requirePerm(mod, 'reader.annotate')
      useReaderState.getState().registerButton(mod.id, { id: String(p.id), title: String(p.title ?? '按钮') })
      return true
    }

    // ---------- UI / 通知 / 剪贴板 ----------
    case 'ui.notify': {
      requirePerm(mod, 'notify')
      useUi.getState().toast(`[${mod.manifest.name}] ${String(p.title ?? '')}`)
      return lh.notify(`LearnHub · ${mod.manifest.name}`, String(p.body ?? p.title ?? ''))
    }
    case 'ui.toast': {
      requirePerm(mod, 'ui.panel')
      return useUi.getState().toast(`[${mod.manifest.name}] ${String(p.text ?? '')}`)
    }
    case 'ui.registerPanel': {
      // 面板由清单 contributes 声明，此处仅校验权限（供模块代码自检）
      requirePerm(mod, 'ui.panel')
      return true
    }
    case 'ui.registerRoute': {
      requirePerm(mod, 'ui.panel')
      return true
    }
    case 'ui.theme': {
      requirePerm(mod, 'ui.theme')
      const cur = useSettings.getState().settings.appearance ?? { accent: '#5b8cff', radius: 10, fontScale: 1 }
      const next = { ...cur }
      if (typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent)) next.accent = p.accent
      if (typeof p.radius === 'number' && Number.isFinite(p.radius)) next.radius = Math.min(20, Math.max(2, p.radius))
      if (typeof p.fontScale === 'number' && Number.isFinite(p.fontScale)) next.fontScale = Math.min(1.3, Math.max(0.85, p.fontScale))
      await useSettings.getState().update({ appearance: next })
      return next
    }
    case 'clipboard.write': {
      requirePerm(mod, 'clipboard')
      return lh.clipboardWrite(String(p.text ?? ''))
    }

    // ---------- 文件 ----------
    case 'files.saveText': {
      requirePerm(mod, 'files.pick')
      return lh.fileSaveText(String(p.fileName ?? 'export.txt'), String(p.content ?? ''))
    }
    case 'files.openText': {
      requirePerm(mod, 'files.pick')
      return lh.fileOpenText(p.filters as never)
    }

    // ---------- 权限升级（走元模块审批） ----------
    case 'request.permission': {
      return metaEscalate({ id: mod.id, manifest: mod.manifest }, String(p.capability ?? ''), String(p.reason ?? ''), 'meta-core', signal)
    }

    // ---------- 元模块 API ----------
    case 'meta.requestPermission': {
      if (mod.manifest.type !== 'meta') throw new PermError('meta.* 仅元模块可用')
      requirePerm(mod, 'meta.escalate')
      const targetId = String(p.moduleId ?? '')
      const target = registry()[targetId]
      if (!target) throw new Error('目标模块不存在: ' + targetId)
      return metaEscalate({ id: target.id, manifest: target.manifest }, String(p.capability ?? ''), String(p.reason ?? ''), mod.manifest.name, signal)
    }
    case 'meta.grants': {
      if (mod.manifest.type !== 'meta') throw new PermError('meta.* 仅元模块可用')
      requirePerm(mod, 'meta.escalate')
      return useGrants.getState().grants[String(p.moduleId ?? '')] ?? []
    }
    case 'meta.revoke': {
      if (mod.manifest.type !== 'meta') throw new PermError('meta.* 仅元模块可用')
      requirePerm(mod, 'meta.escalate')
      const targetId = String(p.moduleId ?? '')
      const target = registry()[targetId]
      if (!target) throw new Error('目标模块不存在: ' + targetId)
      if (typeof p.capability !== 'string' || !isCapability(p.capability)) throw new Error('未知权限，无法撤销')
      const capability = p.capability
      if (target.manifest.permissions.includes(capability)) {
        throw new PermError('必需权限不能单独撤销；请停用或卸载该模块')
      }
      if (!(target.manifest.optionalPermissions ?? []).includes(capability)) {
        throw new PermError('该模块未声明此可选权限')
      }
      return useGrants.getState().revoke(targetId, capability)
    }
    case 'meta.listModules': {
      if (mod.manifest.type !== 'meta') throw new PermError('meta.* 仅元模块可用')
      requirePerm(mod, 'meta.escalate')
      return Object.values(registry()).map((m) => ({ id: m.id, manifest: m.manifest, enabled: m.enabled }))
    }
    case 'meta.getSettings': {
      // 仅暴露非密钥部分（供元模块做高级联动）
      if (mod.manifest.type !== 'meta') throw new PermError('meta.* 仅元模块可用')
      requirePerm(mod, 'meta.escalate')
      const s = useSettings.getState().settings
      return { aiConfigured: !!s.ai.apiKey, aiBaseURL: s.ai.baseURL, githubConfigured: !!s.github.pat, devMode: s.devMode }
    }

    default:
      throw new Error(`未知 API: ${method}`)
  }
}

/** 为内置（进程内）模块构造 host 对象 */
export function createHostFor(mod: ModuleRecord): Record<string, unknown> {
  const call = (path: string) => (params: Record<string, unknown> = {}) => dispatchApi(mod, path, params)
  const ns = (name: string, fns: string[]): Record<string, unknown> =>
    Object.fromEntries(fns.map((f) => [f, call(`${name}.${f}`)]))

  const host: Record<string, unknown> = {
    manifest: {
      id: mod.manifest.id,
      name: mod.manifest.name,
      version: mod.manifest.version,
      type: mod.manifest.type,
      permissions: mod.manifest.permissions,
      optionalPermissions: mod.manifest.optionalPermissions ?? []
    },
    storage: ns('storage', ['get', 'set', 'clear']),
    data: {
      todos: ns('data.todos', ['list', 'add', 'update', 'remove']),
      schedule: ns('data.schedule', ['get']),
      notes: ns('data.notes', ['list', 'write', 'remove']),
      flashcards: ns('data.flashcards', ['list', 'add', 'update', 'remove'])
    },
    ai: { chat: call('ai.chat') },
    network: { fetch: call('network.fetch') },
    links: { open: call('links.open') },
    calendar: ns('calendar', ['addEvents', 'removeEvents']),
    reader: ns('reader', ['getSelection', 'addHighlight', 'openPaper', 'registerToolbarButton']),
    ui: { notify: call('ui.notify'), toast: call('ui.toast'), theme: call('ui.theme') },
    clipboard: { write: call('clipboard.write') },
    files: { saveText: call('files.saveText'), openText: call('files.openText') },
    events: {
      on: (name: string, h: (payload: unknown) => void) => eventBus.on(name, h),
      off: (name: string, h: (payload: unknown) => void) => eventBus.off(name, h),
      emit: (name: string, payload?: unknown) => eventBus.emit(name, payload)
    },
    requestPermission: call('request.permission'),
    capabilities: {
      describe: () => Object.entries(CATALOG).map(([k, v]) => ({ id: k, ...v }))
    }
  }
  if (mod.manifest.type === 'meta') {
    host.meta = ns('meta', ['requestPermission', 'grants', 'revoke', 'listModules', 'getSettings'])
  }
  return host
}
