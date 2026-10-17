import { useEffect, useRef, useState } from 'react'
import { aiChat, aiAbort, type ChatMessage } from '@/lib/ai'
import { eventBus } from '@/kernel/eventBus'
import { usePapers } from '@/stores/papers'
import { useUi } from '@/stores/ui'

/** AI 侧边栏：流式对话；监听阅读器「AI 解释」事件自动携带上下文 */
export function AiPanel() {
  const activePaperId = useUi((s) => s.activePaperId)
  const paper = usePapers((s) => (activePaperId ? s.papers[activePaperId] : undefined))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const reqRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = eventBus.on('ai:explain', (payload) => {
      const p = payload as { text: string; paperId?: string }
      void run([
        { role: 'system', content: '你是学术阅读助手。解释用户给出的论文片段，通俗准确，可用短列表。' },
        { role: 'user', content: `请解释这段内容：\n${p.text}` }
      ])
    })
    return off
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const run = async (msgs: ChatMessage[]) => {
    if (busy) return
    setMessages([...msgs, { role: 'assistant', content: '' }])
    setBusy(true)
    const { id, done } = aiChat({
      messages: msgs,
      onChunk: (d) =>
        setMessages((ms) => {
          const next = [...ms]
          next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + d }
          return next
        })
    })
    reqRef.current = id
    try {
      await done
    } catch (e) {
      setMessages((ms) => {
        const next = [...ms]
        next[next.length - 1] = { role: 'assistant', content: (e as Error).message }
        return next
      })
    } finally {
      setBusy(false)
      reqRef.current = null
    }
  }

  const send = () => {
    const text = input.trim()
    if (!text || busy) return
    const msgs: ChatMessage[] = [
      ...(paper ? [{ role: 'system' as const, content: `当前论文：《${paper.title}》` }] : []),
      ...messages.filter((m) => m.content && m.content !== '...'),
      { role: 'user', content: text }
    ]
    setInput('')
    void run(msgs)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center border-b border-line px-3 py-2 text-xs text-txt-dim">
        <span>{paper ? `上下文：《${paper.title.slice(0, 18)}》` : '通用对话'}</span>
        <div className="ml-auto flex gap-2">
          {busy && reqRef.current && (
            <button className="rounded-md border border-red-400/40 px-1.5 py-0.5 text-red-400 hover:bg-red-400/10" onClick={() => reqRef.current && aiAbort(reqRef.current)}>
              停止
            </button>
          )}
          {messages.length > 0 && !busy && (
            <button className="rounded-md border border-line px-1.5 py-0.5 text-txt-dim hover:border-accent hover:text-accent" onClick={() => setMessages([])}>
              清空
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="mt-10 text-center text-xs text-txt-dim">
            在论文中选中文字 →「AI」可自动解释。
            <br />
            也可直接输入问题。
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-6 ${
                m.role === 'user' ? 'bg-accent text-white' : 'border border-line bg-bg-card'
              }`}
            >
              {m.content || (busy && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            className="h-16 flex-1 resize-none rounded-lg border border-line bg-bg p-2 text-sm"
            placeholder="输入问题…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50" disabled={busy || !input.trim()} onClick={send}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
