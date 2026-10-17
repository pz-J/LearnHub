import { useEffect, useRef, useState } from 'react'
import { useReaderState } from '@/stores/readerState'
import { useUi } from '@/stores/ui'
import { eventBus, EVENTS } from '@/kernel/eventBus'
import { aiChat, aiAbort } from '@/lib/ai'
import { lh, uid } from '@/lib/ipc'

/** 内置子模块：划词翻译 —— 侧边栏面板 + 阅读器选区工具条按钮，AI 流式翻译 */
export function TranslateModule() {
  const setSidebarTab = useUi((s) => s.setSidebarTab)
  const toast = useUi((s) => s.toast)
  const [lang, setLang] = useState<'中文' | '英文'>('中文')
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<{ id: string; src: string; dst: string }[]>([])
  const reqRef = useRef<string | null>(null)

  // 注册阅读器选区工具条按钮（声明了 reader.annotate 权限）
  useEffect(() => {
    useReaderState.getState().registerButton('core.translate', { id: 'translate', title: '翻译选中文本' })
    const off = eventBus.on(EVENTS.readerToolbarClick, (payload) => {
      const p = payload as { moduleId: string; id: string; text?: string }
      if (p.moduleId !== 'core.translate') return
      setSidebarTab('core.translate:panel')
      if (p.text) {
        setInput(p.text)
        void doTranslate(p.text)
      } else {
        toast('请先在论文中选中文字', 'error')
      }
    })
    return () => {
      off()
      useReaderState.getState().unregisterModule('core.translate')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doTranslate = (text: string) => {
    if (!text.trim() || busy) return
    setBusy(true)
    setResult('')
    const reqId = uid('tr_')
    reqRef.current = reqId
    const target = lang === '中文' ? '中文' : '英文'
    const { id, done } = aiChat({
      messages: [
        { role: 'system', content: `你是学术翻译。将用户输入翻译为${target}，保留术语准确，只输出译文。` },
        { role: 'user', content: text.slice(0, 6000) }
      ],
      temperature: 0.2,
      onChunk: (d) => setResult((r) => r + d)
    })
    reqRef.current = id
    done
      .then((full) => {
        setHistory((h) => [{ id: reqId, src: text.slice(0, 120), dst: full }, ...h].slice(0, 20))
      })
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-xs text-txt-dim">译为</span>
        <select
          className="rounded border border-line bg-bg px-2 py-1 text-xs"
          value={lang}
          onChange={(e) => setLang(e.target.value as '中文' | '英文')}
        >
          <option value="中文">中文</option>
          <option value="英文">英文</option>
        </select>
        <div className="ml-auto flex gap-1">
          {busy && (
            <button className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10" onClick={() => reqRef.current && aiAbort(reqRef.current)}>
              停止
            </button>
          )}
          <button
            className="rounded bg-accent px-3 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
            disabled={busy || !input.trim()}
            onClick={() => void doTranslate(input)}
          >
            翻译
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <textarea
          className="h-24 w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm"
          placeholder="输入或从论文选中文本后点击工具条「翻译」"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {result && (
          <div className="rounded-lg border border-line bg-bg-card p-3 text-sm leading-6">
            <div className="mb-1 flex items-center justify-between text-xs text-txt-dim">
              <span>译文</span>
              <button
                className="hover:text-accent"
                onClick={() => {
                  void lh.clipboardWrite(result)
                  toast('已复制译文', 'ok')
                }}
              >
                复制
              </button>
            </div>
            <div className="whitespace-pre-wrap">{result}</div>
          </div>
        )}
        {history.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs text-txt-dim">最近翻译</div>
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="cursor-pointer rounded-lg border border-line bg-bg-soft p-2 text-xs hover:bg-bg-hover" onClick={() => setInput(h.src)}>
                  <div className="truncate text-txt-dim">{h.src}</div>
                  <div className="mt-0.5 line-clamp-2">{h.dst}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
