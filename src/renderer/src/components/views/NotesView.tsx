import { useCallback, useEffect, useRef, useState } from 'react'
import { useNotes } from '@/stores/notes'
import { usePapers } from '@/stores/papers'
import { PaperNoteBody } from '@/components/sidebar/PaperNoteBody'
import { fmtTime, truncate } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { useTodos } from '@/stores/todos'
import { researchActionFromNote, researchSourceFromNote } from '@/lib/researchActions'
import { today } from '@/lib/utils'

/** 笔记页：左侧「论文笔记（按论文收纳）」+「自由笔记」；右侧为所选内容 */
export function NotesView() {
  const notes = useNotes((s) => s.notes)
  const notesLoaded = useNotes((s) => s.loaded)
  const write = useNotes((s) => s.write)
  const remove = useNotes((s) => s.remove)
  const todos = useTodos((s) => s.items)
  const addTodo = useTodos((s) => s.add)
  const toast = useUi((s) => s.toast)
  const requestedNoteId = useUi((s) => s.requestedNoteId)
  const openPaperAtHighlight = useUi((s) => s.openPaperAtHighlight)
  const openPaperAtPage = useUi((s) => s.openPaperAtPage)
  const papers = usePapers((s) => s.papers)
  const order = usePapers((s) => s.order)
  const [selPaper, setSelPaper] = useState<string | null>(null)
  const [selNote, setSelNote] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState({ id: '', title: '', tags: '', body: '' })
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [removingNoteId, setRemovingNoteId] = useState<string | null>(null)
  const draftRevision = useRef(0)
  const processingNoteRequest = useRef<string | null>(null)
  const deletingNoteIds = useRef(new Set<string>())
  const latestDraft = useRef(draft)
  const latestDirty = useRef(dirty)
  latestDraft.current = draft
  latestDirty.current = dirty

  const note = selNote ? notes[selNote] : undefined

  useEffect(() => {
    if (!note) return
    draftRevision.current += 1
    setDraft({ id: note.id, title: note.title ?? '未命名笔记', tags: (note.tags ?? []).join(','), body: note.body ?? '' })
    setDirty(false)
    setSaveState('saved')
  }, [note?.id])

  const saveDraft = useCallback(async (snapshot: typeof draft, revision: number) => {
    if (!snapshot.id || deletingNoteIds.current.has(snapshot.id)) return false
    setSaveState('saving')
    try {
      await write(snapshot.id, { title: snapshot.title, tags: snapshot.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean), body: snapshot.body })
      if (draftRevision.current === revision) {
        setDirty(false)
        setSaveState('saved')
      }
      return draftRevision.current === revision
    } catch (error) {
      setSaveState('error')
      toast(`笔记保存失败：${(error as Error).message || '请重试'}`, 'error')
      return false
    }
  }, [write, toast])

  const deleteNote = async (id: string) => {
    if (deletingNoteIds.current.size || !confirm(`删除笔记「${truncate(notes[id]?.title ?? id, 16)}」？`)) return
    deletingNoteIds.current.add(id)
    setRemovingNoteId(id)
    try {
      await remove(id)
      if (draft.id === id) {
        // Prevent the unmount autosave and a pending debounce from recreating a note
        // the user has explicitly confirmed deleting.
        latestDirty.current = false
        draftRevision.current += 1
        setDirty(false)
        setSelNote(null)
      }
      toast('笔记已删除', 'ok')
    } catch (error) {
      toast(`删除笔记失败：${(error as Error).message || '请重试'}`, 'error')
      // If an autosave timer fired while deletion was in flight, reschedule it only
      // after releasing the deletion guard so failed deletes do not lose draft edits.
      if (latestDirty.current && latestDraft.current.id === id) {
        const snapshot = latestDraft.current
        const revision = draftRevision.current
        window.setTimeout(() => { void saveDraft(snapshot, revision) }, 450)
      }
    } finally {
      deletingNoteIds.current.delete(id)
      setRemovingNoteId(null)
    }
  }

  useEffect(() => {
    const requested = requestedNoteId
    if (!requested || processingNoteRequest.current === requested) return
    if (notes[requested]) {
      processingNoteRequest.current = requested
      const openRequested = () => {
        if (useUi.getState().requestedNoteId !== requested) {
          processingNoteRequest.current = null
          return
        }
        useUi.getState().consumeRequestedNote()
        setSelNote(requested)
        setSelPaper(null)
        processingNoteRequest.current = null
      }
      if (dirty && draft.id) {
        void saveDraft(draft, draftRevision.current).then((saved) => {
          if (saved) openRequested()
          else processingNoteRequest.current = null
        })
      } else openRequested()
    } else if (notesLoaded) {
      useUi.getState().consumeRequestedNote()
      toast('这条研究笔记已不存在；关联待办和其他记录仍会保留。', 'info')
    }
  }, [requestedNoteId, notes, notesLoaded, dirty, draft, saveDraft, toast])

  useEffect(() => () => {
    if (latestDirty.current && latestDraft.current.id) void saveDraft(latestDraft.current, draftRevision.current)
  }, [saveDraft])

  useEffect(() => {
    if (!dirty || !note || draft.id !== note.id) return
    const snapshot = draft
    const revision = draftRevision.current
    const timer = window.setTimeout(() => { void saveDraft(snapshot, revision) }, 450)
    return () => window.clearTimeout(timer)
  }, [draft, dirty, note?.id, saveDraft])

  const editDraft = (patch: Partial<typeof draft>) => {
    draftRevision.current += 1
    setDraft((current) => ({ ...current, ...patch }))
    setDirty(true)
    setSaveState('idle')
  }
  const noteList = Object.values(notes)
    .filter((n) => !q || String(n.title ?? '').toLowerCase().includes(q.toLowerCase()) || String(n.body ?? '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const paperList = order
    .map((id) => papers[id])
    .filter((p) => p && (!q || p.title.toLowerCase().includes(q.toLowerCase())))

  return (
    <div className="flex h-full overflow-hidden p-4">
      {/* 左列：论文笔记 + 自由笔记 */}
      <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-bg-card">
        <div className="border-b border-line p-2">
          <input
            className="w-full rounded border border-line bg-bg px-2 py-1.5 text-xs"
            placeholder="搜索论文 / 笔记…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {/* 论文笔记：每篇论文一个分区（链路导图 + 问答 + 标记解释） */}
          <div className="mb-1 px-1 text-xs font-medium text-txt-dim">论文笔记（按论文收纳）</div>
          {paperList.map((p) => {
            const nHl = (p.highlights ?? []).length
            const nAns = (p.answers ?? []).length
            return (
              <div
                key={p.id}
                className={`group cursor-pointer rounded-lg p-2.5 text-sm hover:bg-bg-hover ${selPaper === p.id ? 'bg-bg-hover' : ''}`}
                onClick={async () => {
                  if (dirty && !(await saveDraft(draft, draftRevision.current))) return
                  setSelPaper(p.id)
                  setSelNote(null)
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                  <span className="shrink-0 text-[10px] text-txt-dim">
                    {nHl} 标记{nAns > 0 ? ` · ${nAns} 问答` : ''}
                  </span>
                </div>
              </div>
            )
          })}
          {paperList.length === 0 && <div className="px-1 py-1 text-xs text-txt-dim">还没有论文。在文献库导入后自动出现在这里。</div>}

          {/* 自由笔记 */}
          <div className="mb-1 mt-3 flex items-center px-1">
            <span className="flex-1 text-xs font-medium text-txt-dim">自由笔记</span>
            <button
              className="rounded bg-accent px-2 py-0.5 text-xs text-white hover:opacity-90"
              onClick={async () => {
                if (dirty && !(await saveDraft(draft, draftRevision.current))) return
                const n = await write(null, { title: '新笔记', body: '' })
                setSelNote(n.id)
                setSelPaper(null)
              }}
            >
              +
            </button>
          </div>
          {noteList.map((n) => (
            <div
              key={n.id}
              className={`group cursor-pointer rounded-lg p-2.5 text-sm hover:bg-bg-hover ${selNote === n.id ? 'bg-bg-hover' : ''}`}
              onClick={async () => {
                if (dirty && !(await saveDraft(draft, draftRevision.current))) return
                setSelNote(n.id)
                setSelPaper(null)
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
                <button
                  className="text-xs text-red-400 opacity-0 group-hover:opacity-100"
                  disabled={removingNoteId !== null}
                  aria-label={`删除笔记：${n.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteNote(n.id)
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="mt-0.5 truncate text-xs text-txt-dim">
                {n.paperId && papers[n.paperId] ? `${truncate(papers[n.paperId].title, 12)} · ` : ''}
                {truncate(n.body.replace(/[#>*\n]/g, ' ').trim(), 24) || '（空）'}
              </div>
              <div className="mt-0.5 text-xs text-txt-dim">{n.updatedAt ? fmtTime(n.updatedAt) : ''}</div>
            </div>
          ))}
          {noteList.length === 0 && <div className="px-1 py-1 text-xs text-txt-dim">暂无自由笔记。点 + 新建。</div>}
        </div>
      </div>

      {/* 右侧：论文笔记视图 / 自由笔记编辑 */}
      <div className="ml-4 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-bg-card">
        {selPaper ? (
          <PaperNoteBody paperId={selPaper} />
        ) : note ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2">
              <input
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                value={draft.id === note.id ? draft.title : note.title ?? '未命名笔记'}
                onChange={(e) => editDraft({ title: e.target.value })}
              />
              <input
                className="w-40 rounded border border-line bg-bg px-2 py-1 text-xs"
                placeholder="标签，逗号分隔"
                value={draft.id === note.id ? draft.tags : (note.tags ?? []).join(',')}
                onChange={(e) => editDraft({ tags: e.target.value })}
              />
              {(() => {
                const action = researchActionFromNote(note)
                const exists = todos.some((todo) => todo.sourceKey === action.sourceKey)
                return <button
                  className="lh-button shrink-0 text-xs disabled:opacity-50"
                  disabled={exists}
                  title={exists ? '此笔记已生成后续行动' : '将笔记中的研究问题或结论转为待办'}
                  onClick={async () => {
                    try {
                      const created = await addTodo({ title: action.title, date: today(), tags: ['研究行动'], sourceKey: action.sourceKey, sourceNoteId: action.sourceNoteId, sourcePaperId: action.sourcePaperId, sourcePage: action.sourcePage })
                      toast(todos.some((todo) => todo.id === created.id) ? '该研究行动已存在' : '已加入学习首页的后续行动', 'ok', () => useUi.getState().openNote(note.id))
                    } catch (error) {
                      toast(`创建研究行动失败：${(error as Error).message || '请重试'}`, 'error')
                    }
                  }}
                >{exists ? '已加入行动' : '转为后续行动'}</button>
              })()}
              <span className="shrink-0 text-[10px] text-txt-dim" aria-live="polite">{saveState === 'saving' ? '保存中…' : saveState === 'saved' && !dirty ? '已保存' : saveState === 'error' ? '保存失败' : dirty ? '未保存' : ''}</span>
              {saveState === 'error' && <button className="lh-button shrink-0 px-2 py-1 text-[11px]" onClick={() => void saveDraft(draft, draftRevision.current)}>重试</button>}
            </div>
            {(() => {
              const source = researchSourceFromNote(note)
              if (!source || !(note.paperId || source.paperId)) return null
              const sourcePaperId = note.paperId ?? source.paperId
              const sourcePaper = sourcePaperId ? papers[sourcePaperId] : undefined
              const normalizedQuote = source.quote.replace(/\s+/g, '').toLocaleLowerCase()
              const mark = sourcePaper?.highlights?.find((h) => h.page === source.page && h.text.replace(/\s+/g, '').toLocaleLowerCase() === normalizedQuote)
              return <div className="flex items-center gap-2 border-b border-line bg-accent/5 px-4 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-txt-dim">原文来源：{sourcePaper?.title ?? '原论文已不在文献库'} · 第 {source.page} 页</span>
                {sourcePaper ? <button className="lh-button shrink-0 px-2 py-1 text-[11px]" onClick={() => {
                  if (mark) openPaperAtHighlight(sourcePaper.id, mark.id)
                  else {
                    openPaperAtPage(sourcePaper.id, source.page)
                    toast('正在定位到来源页；对应原文标记可能已删除', 'info')
                  }
                }}>回到原文 →</button> : <span className="text-txt-dim">笔记保留，来源链接不可用</span>}
              </div>
            })()}
            <textarea
              className="flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-6 outline-none"
              value={draft.id === note.id ? draft.body : note.body ?? ''}
              onChange={(e) => editDraft({ body: e.target.value })}
              placeholder="支持 Markdown…"
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-txt-dim">左侧选择一篇论文（导图 + 问答 + 标记解释）或一篇自由笔记</div>
        )}
      </div>
    </div>
  )
}
