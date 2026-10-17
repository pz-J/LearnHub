import { useState } from 'react'
import { usePapers } from '@/stores/papers'
import { useUi } from '@/stores/ui'
import { lh } from '@/lib/ipc'
import { fmtTime, truncate } from '@/lib/utils'

/** 文献库：导入 / 标签 / 打开阅读 / 删除 */
export function LibraryView() {
  const papers = usePapers((s) => s.papers)
  const order = usePapers((s) => s.order)
  const add = usePapers((s) => s.add)
  const update = usePapers((s) => s.update)
  const remove = usePapers((s) => s.remove)
  const openPaper = useUi((s) => s.openPaper)
  const navigate = useUi((s) => s.navigate)
  const toast = useUi((s) => s.toast)
  const [tagInput, setTagInput] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')

  const importPdf = async () => {
    const r = (await lh.pdfPickImport()) as { id: string; fileName: string } | null
    if (!r) return
    await add({ id: r.id, fileName: r.fileName })
    toast('导入成功，双击开始阅读', 'ok')
  }

  const list = order
    .map((id) => papers[id])
    .filter(Boolean)
    .filter((p) => !query || p.title.toLowerCase().includes(query.toLowerCase()) || p.tags.some((t) => t.includes(query)))

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">文献库</h1>
        <input
          className="w-56 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm"
          placeholder="搜索标题 / 标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:opacity-90" onClick={() => void importPdf()}>
          导入 PDF
        </button>
      </div>

      <div className="grid flex-1 grid-cols-1 content-start gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => (
          <div
            key={p.id}
            className="group flex cursor-pointer flex-col rounded-xl border border-line bg-bg-card p-4 transition-colors hover:border-accent/60"
            onDoubleClick={() => openPaper(p.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1" onClick={() => openPaper(p.id)}>
                <div className="line-clamp-2 font-medium leading-6 group-hover:text-accent">{p.title}</div>
                <div className="mt-1 truncate text-xs text-txt-dim">{p.fileName}</div>
              </div>
              <button
                className="shrink-0 rounded p-1 text-xs text-txt-dim opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                title="删除"
                onClick={() => {
                  if (confirm(`确定删除《${truncate(p.title, 20)}》？PDF 原件与批注将一并移除。`)) void remove(p.id)
                }}
              >
                ✕
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {p.tags.map((t) => (
                <span key={t} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                  {t}
                </span>
              ))}
            </div>
            <input
              className="mt-2 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-txt-dim outline-none placeholder:text-txt-dim/60 focus:border-line focus:bg-bg"
              placeholder="+ 输入标签后回车"
              value={tagInput[p.id] ?? ''}
              onChange={(e) => setTagInput({ ...tagInput, [p.id]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = (tagInput[p.id] ?? '').trim()
                  if (v && !p.tags.includes(v)) void update(p.id, { tags: [...p.tags, v] })
                  setTagInput({ ...tagInput, [p.id]: '' })
                }
              }}
            />

            <div className="mt-3 flex items-center gap-3 text-xs text-txt-dim">
              <span>高亮 {p.highlights.length}</span>
              <span>搜索 {p.searches.length}</span>
              <span className="ml-auto">{fmtTime(p.createdAt)}</span>
              <button
                className="rounded-md border border-accent/40 px-2 py-1 text-accent hover:bg-accent/10"
                onClick={() => openPaper(p.id)}
              >
                阅读 →
              </button>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div className="col-span-full py-16 text-center text-sm text-txt-dim">
            还没有文献。点击右上角「导入 PDF」添加你的第一篇论文；导入课表也可先在日历页操作。
            <div className="mt-3 flex items-center justify-center gap-3">
              <button
                className="rounded-md border border-accent/40 px-3 py-1.5 text-accent hover:bg-accent/10"
                onClick={() => void importPdf()}
              >
                立即导入
              </button>
              <button
                className="rounded-md border border-line px-3 py-1.5 text-txt-dim hover:border-accent hover:text-accent"
                onClick={() => navigate('calendar')}
              >
                去导入课表
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
