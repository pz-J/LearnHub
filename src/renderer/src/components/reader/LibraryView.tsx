import { useMemo, useState } from 'react'
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
  const [status, setStatus] = useState<'all' | 'unread' | 'finished'>('all')
  const [sort, setSort] = useState<'updated' | 'added' | 'title'>('updated')

  const importPdf = async () => {
    try {
      const r = (await lh.pdfPickImport()) as { id: string; fileName: string } | null
      if (!r) return
      await add({ id: r.id, fileName: r.fileName })
      toast('导入成功，可以立即开始阅读', 'ok')
    } catch (error) {
      toast(`导入失败：${(error as Error).message || '请检查 PDF 文件后重试'}`, 'error')
    }
  }

  const list = useMemo(() => order
    .map((id) => papers[id])
    .filter(Boolean)
    .filter((p) => status === 'all' || (status === 'finished' ? !!p.finished : !p.finished))
    .filter((p) => !query || [p.title, p.fileName, p.meta?.authors, p.meta?.doi, p.meta?.year, p.meta?.venue, ...p.tags, ...p.highlights.flatMap((h) => [h.text, h.note, h.aiExplain]), ...(p.answers || []).flatMap((a) => [a.question, a.quote])].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'added' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt), [order, papers, status, query, sort])

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto"><h1 className="text-lg font-semibold">文献库</h1><p className="mt-0.5 text-xs text-txt-dim">{list.length} 篇文献 · 搜索标题、作者、DOI 或标签</p></div>
        <input
          className="w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm sm:w-64"
          placeholder="搜索标题 / 作者 / DOI / 标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:opacity-90" onClick={() => void importPdf()}>
          + 导入 PDF
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-bg p-1">
          {([{ id: 'all', label: `全部 ${order.length}` }, { id: 'unread', label: `待读 ${order.filter((id) => !papers[id]?.finished).length}` }, { id: 'finished', label: `已读完 ${order.filter((id) => papers[id]?.finished).length}` }] as const).map((item) => <button key={item.id} className={`rounded-md px-3 py-1 text-xs ${status === item.id ? 'bg-accent/15 font-medium text-accent' : 'text-txt-dim hover:text-txt'}`} onClick={() => setStatus(item.id)}>{item.label}</button>)}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-txt-dim">排序
          <select className="rounded-lg border border-line bg-bg px-2 py-1.5 text-xs text-txt" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="updated">最近更新</option><option value="added">最近添加</option><option value="title">标题 A–Z</option>
          </select>
        </label>
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
                <div className="mt-1 truncate text-xs text-txt-dim">{[p.meta?.authors, p.meta?.year, p.meta?.venue].filter(Boolean).join(' · ') || p.fileName}</div>
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

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-txt-dim">
              <span>高亮 {p.highlights.length}</span>
              <span>搜索 {p.searches.length}</span>
              <span>{(p.answers || []).length} 条问答</span>
              <span className="ml-auto">更新于 {fmtTime(p.updatedAt)}</span>
              {p.finished && <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-green-400">已读完</span>}
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
