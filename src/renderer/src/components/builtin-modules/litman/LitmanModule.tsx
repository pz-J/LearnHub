import { useState } from 'react'
import { usePapers } from '@/stores/papers'
import { useUi } from '@/stores/ui'
import { lh } from '@/lib/ipc'
import { fetchMeta, toBibtex, aiSummarizeAbstract } from '@/lib/bibtex'
import { extractPdfPages } from '@/lib/pdf'

/** 内置子模块：文献助手 —— CrossRef 元数据检索 / BibTeX 导出 / AI 摘要 */
export function LitmanModule() {
  const activePaperId = useUi((s) => s.activePaperId)
  const paper = usePapers((s) => (activePaperId ? s.papers[activePaperId] : undefined))
  const update = usePapers((s) => s.update)
  const toast = useUi((s) => s.toast)
  const [doi, setDoi] = useState('')
  const [busy, setBusy] = useState('')
  const [summary, setSummary] = useState('')

  if (!paper) {
    return <div className="p-4 text-sm text-txt-dim">先在「文献库」打开一篇论文，即可检索元数据、导出 BibTeX。</div>
  }

  const queryDoi = doi.trim() || paper.meta.doi

  const doFetch = async () => {
    setBusy('meta')
    try {
      if (doi.trim() && doi.trim() !== paper.meta.doi) await update(paper.id, { meta: { ...paper.meta, doi: doi.trim() } })
      const meta = await fetchMeta({ ...paper, meta: { ...paper.meta, doi: queryDoi } })
      await update(paper.id, { meta: { ...paper.meta, ...meta } })
      toast('已获取元数据', 'ok')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  const doBibtex = async (download: boolean) => {
    setBusy('bib')
    try {
      const bib = await toBibtex(paper)
      if (download) await lh.fileSaveText(`${paper.title.slice(0, 30)}.bib`, bib)
      else await lh.clipboardWrite(bib)
      toast(download ? 'BibTeX 已保存' : 'BibTeX 已复制', 'ok')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  const doSummary = async () => {
    setBusy('sum')
    try {
      const pages = await extractPdfPages(paper.id)
      const text = await aiSummarizeAbstract(paper.title, pages[0]?.text ?? '')
      setSummary(text)
      await update(paper.id, { meta: { ...paper.meta, bibtex: paper.meta.bibtex } })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 text-sm">
      <div className="mb-2 font-medium">文献助手</div>
      <div className="mb-3 rounded-lg border border-line bg-bg-soft p-2 text-xs leading-5">
        <div className="line-clamp-2 font-medium">{paper.title}</div>
        <div className="mt-1 text-txt-dim">{paper.fileName}</div>
      </div>

      <div className="mb-1 text-xs text-txt-dim">DOI（可手动输入后检索）</div>
      <div className="mb-3 flex gap-1">
        <input
          className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs"
          placeholder="10.xxxx/xxxxx"
          value={doi || paper.meta.doi}
          onChange={(e) => setDoi(e.target.value)}
        />
        <button className="rounded bg-accent px-2.5 py-1 text-xs text-white disabled:opacity-50" disabled={!!busy} onClick={() => void doFetch()}>
          {busy === 'meta' ? '检索中…' : '检索'}
        </button>
      </div>

      <div className="mb-3 space-y-1 rounded-lg border border-line bg-bg-soft p-2 text-xs">
        <div><span className="text-txt-dim">作者：</span>{paper.meta.authors || '—'}</div>
        <div><span className="text-txt-dim">年份：</span>{paper.meta.year || '—'}</div>
        <div><span className="text-txt-dim">期刊：</span>{paper.meta.venue || '—'}</div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <button className="rounded border border-line py-1.5 text-xs hover:bg-bg-hover disabled:opacity-50" disabled={!!busy} onClick={() => void doBibtex(false)}>
          复制 BibTeX
        </button>
        <button className="rounded border border-line py-1.5 text-xs hover:bg-bg-hover disabled:opacity-50" disabled={!!busy} onClick={() => void doBibtex(true)}>
          导出 .bib
        </button>
      </div>

      <button className="mb-2 rounded bg-accent/20 py-1.5 text-xs text-accent hover:bg-accent/30 disabled:opacity-50" disabled={!!busy} onClick={() => void doSummary()}>
        {busy === 'sum' ? 'AI 总结中…' : 'AI 总结核心贡献'}
      </button>
      {summary && <div className="rounded-lg border border-line bg-bg-card p-2 text-xs leading-5">{summary}</div>}
    </div>
  )
}
