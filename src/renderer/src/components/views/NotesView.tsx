import { useState } from 'react'
import { useNotes } from '@/stores/notes'
import { usePapers } from '@/stores/papers'
import { PaperNoteBody } from '@/components/sidebar/PaperNoteBody'
import { fmtTime, truncate } from '@/lib/utils'

/** 笔记页：左侧「论文笔记（按论文收纳）」+「自由笔记」；右侧为所选内容 */
export function NotesView() {
  const notes = useNotes((s) => s.notes)
  const write = useNotes((s) => s.write)
  const remove = useNotes((s) => s.remove)
  const papers = usePapers((s) => s.papers)
  const order = usePapers((s) => s.order)
  const [selPaper, setSelPaper] = useState<string | null>(null)
  const [selNote, setSelNote] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const note = selNote ? notes[selNote] : undefined
  const noteList = Object.values(notes)
    .filter((n) => !q || n.title.toLowerCase().includes(q.toLowerCase()) || n.body.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
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
            const nHl = p.highlights.length
            const nAns = (p.answers ?? []).length
            return (
              <div
                key={p.id}
                className={`group cursor-pointer rounded-lg p-2.5 text-sm hover:bg-bg-hover ${selPaper === p.id ? 'bg-bg-hover' : ''}`}
                onClick={() => {
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
              onClick={() => {
                setSelNote(n.id)
                setSelPaper(null)
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
                <button
                  className="text-xs text-red-400 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`删除笔记「${truncate(n.title, 16)}」？`)) void remove(n.id)
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
                value={note.title}
                onChange={(e) => void write(note.id, { title: e.target.value })}
              />
              <input
                className="w-40 rounded border border-line bg-bg px-2 py-1 text-xs"
                placeholder="标签，逗号分隔"
                value={note.tags.join(',')}
                onChange={(e) => void write(note.id, { tags: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
              />
            </div>
            <textarea
              className="flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-6 outline-none"
              value={note.body}
              onChange={(e) => void write(note.id, { body: e.target.value })}
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
