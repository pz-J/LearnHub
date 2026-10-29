import { useEffect, useRef, useState } from 'react'
import { aiChat, aiAbort, type ChatMessage } from '@/lib/ai'
import { eventBus } from '@/kernel/eventBus'
import { usePapers } from '@/stores/papers'
import { useNotes } from '@/stores/notes'
import { useUi } from '@/stores/ui'
import type { Highlight } from '@/types'
import { lh } from '@/lib/ipc'
import { buildResearchNoteBody, findResearchNote, researchSourceKey } from '@/lib/researchRecord'

/** AI 侧边栏：流式对话；监听阅读器「AI 解释」事件自动携带上下文 */
export function AiPanel() {
  const activePaperId = useUi((s) => s.activePaperId)
  const paper = usePapers((s) => (activePaperId ? s.papers[activePaperId] : undefined))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [explainContext, setExplainContext] = useState<{ text: string; paperId: string; page: number; rects: Highlight['rects'] } | null>(null)
  const [savingExplain, setSavingExplain] = useState(false)
  const reqRef = useRef<string | null>(null)
  // React state updates are asynchronous; this ref prevents two event-driven requests
  // from starting in the same render before `busy` has propagated.
  const busyRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = eventBus.on('ai:explain', (payload) => {
      const p = payload as { text: string; paperId?: string; page?: number; rects?: Highlight['rects'] }
      if (p.paperId && p.page && p.rects?.length) setExplainContext({ text: p.text, paperId: p.paperId, page: p.page, rects: p.rects })
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
    if (busyRef.current) return
    busyRef.current = true
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
      busyRef.current = false
      setBusy(false)
      reqRef.current = null
    }
  }

  const send = () => {
    const text = input.trim()
    if (!text || busy) return
    // Do not associate a later general chat response with an earlier source selection.
    setExplainContext(null)
    const msgs: ChatMessage[] = [
      ...(paper ? [{ role: 'system' as const, content: `当前论文：《${paper.title}》` }] : []),
      ...messages.filter((m) => m.content && m.content !== '...'),
      { role: 'user', content: text }
    ]
    setInput('')
    void run(msgs)
  }

  const saveExplanation = async () => {
    if (!explainContext || savingExplain || busy) return
    const answer = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content.trim()
    if (!answer) return
    setSavingExplain(true)
    try {
      const store = usePapers.getState()
      const paperNow = store.papers[explainContext.paperId]
      if (!paperNow) throw new Error('原论文已不在文献库中，请重新打开论文后再保存')
      const existing = paperNow.highlights.find((h) => h.page === explainContext.page && h.text.replace(/\s+/g, '').toLowerCase() === explainContext.text.replace(/\s+/g, '').toLowerCase())
      if (existing) {
        try {
          await store.updateHighlight(paperNow.id, existing.id, { aiExplain: answer })
        } catch (error) {
          // updateHighlight updates Zustand optimistically; restore the visible value if disk write fails.
          await store.updateHighlight(paperNow.id, existing.id, { aiExplain: existing.aiExplain }).catch(() => undefined)
          throw error
        }
      }
      else {
        const created = store.addHighlight(paperNow.id, { page: explainContext.page, rects: explainContext.rects, text: explainContext.text, color: '#ffd54d', aiExplain: answer })
        if (!created) throw new Error('创建来源标记失败')
        try {
          await lh.dataWrite(`papers/${paperNow.id}.json`, usePapers.getState().papers[paperNow.id])
        } catch (error) {
          await store.removeHighlight(paperNow.id, created.id).catch(() => undefined)
          throw error
        }
      }
      useUi.getState().toast(`解释已保存到《${paperNow.title}》第 ${explainContext.page} 页的原文标记`, 'ok')
    } catch (error) {
      useUi.getState().toast(`保存解释失败：${(error as Error).message || '请重试'}`, 'error')
    } finally {
      setSavingExplain(false)
    }
  }

  const saveResearchNote = async () => {
    if (!explainContext || savingExplain || busy) return
    const explanation = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content.trim()
    if (!explanation) return
    setSavingExplain(true)
    try {
      const sourcePaper = usePapers.getState().papers[explainContext.paperId]
      if (!sourcePaper) throw new Error('来源论文已不存在，请重新打开论文后再保存')
      const notes = useNotes.getState()
      const key = researchSourceKey(sourcePaper.id, explainContext.page, explainContext.text)
      const existing = findResearchNote(Object.values(notes.notes), key)
      if (existing) {
        useUi.getState().openNote(existing.id)
        useUi.getState().toast('这段原文已有研究笔记，已为你打开，避免重复创建', 'info')
        return
      }
      const title = `研究记录 · ${sourcePaper.title.slice(0, 36)} · P${explainContext.page}`
      const note = await notes.write(null, {
        title,
        tags: ['研究记录', 'AI解释'],
        paperId: sourcePaper.id,
        body: buildResearchNoteBody({ key, paperTitle: sourcePaper.title, page: explainContext.page, quote: explainContext.text, explanation })
      })
      useUi.getState().toast('研究笔记已保存，包含论文、页码和原文证据', 'ok', () => useUi.getState().openNote(note.id))
    } catch (error) {
      useUi.getState().toast(`研究笔记保存失败：${(error as Error).message || '请重试'}`, 'error')
    } finally {
      setSavingExplain(false)
    }
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

      {explainContext && <div className="flex items-center gap-2 border-b border-line bg-accent/5 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-txt-dim">解释来源：第 {explainContext.page} 页 · {explainContext.text.slice(0, 60)}</span>
        <button className="lh-button shrink-0 px-2 py-1 text-[11px] disabled:opacity-50" disabled={busy || savingExplain || !messages.some((m) => m.role === 'assistant' && m.content.trim())} onClick={() => void saveExplanation()}>{savingExplain ? '保存中…' : '保存到标记'}</button>
        <button className="lh-button lh-button-primary shrink-0 px-2 py-1 text-[11px] disabled:opacity-50" disabled={busy || savingExplain || !messages.some((m) => m.role === 'assistant' && m.content.trim())} onClick={() => void saveResearchNote()}>{savingExplain ? '保存中…' : '保存为研究笔记'}</button>
      </div>}

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
