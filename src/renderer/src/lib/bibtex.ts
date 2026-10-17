import type { Paper } from '@/types'
import { aiAsk } from './ai'

/** CrossRef 按 DOI 或标题检索元数据（免 Key 公共 API） */
export async function fetchMeta(paper: Paper): Promise<Partial<Paper['meta']>> {
  const q = paper.meta.doi
    ? `https://api.crossref.org/works/${encodeURIComponent(paper.meta.doi)}`
    : `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(paper.title)}&rows=1`
  const res = await fetch(q)
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status}`)
  const j = await res.json()
  const item = j.message?.works ? j.message.works[0] : j.message
  if (!item) throw new Error('未找到匹配文献')
  const authors = (item.author ?? [])
    .map((a: { given?: string; family?: string }) => [a.given, a.family].filter(Boolean).join(' '))
    .join(' and ')
  const year = item.issued?.['date-parts']?.[0]?.[0] ? String(item.issued['date-parts'][0][0]) : ''
  return {
    doi: item.DOI ?? paper.meta.doi,
    authors,
    year,
    venue: item['container-title']?.[0] ?? ''
  }
}

/** 生成 BibTeX（有 AI 时更规范，否则用模板） */
export async function toBibtex(paper: Paper): Promise<string> {
  const m = paper.meta
  const firstAuthor = m.authors.split(/\s+and\s+/)[0] ?? 'unknown'
  const last = firstAuthor.split(' ').pop() ?? 'unknown'
  const key = `${last}${m.year || ''}${paper.title.slice(0, 12).replace(/\W/g, '')}`
  const hasMeta = !!m.authors || !!m.year
  if (!hasMeta) {
    try {
      const fetched = await fetchMeta(paper)
      Object.assign(m, fetched)
    } catch {
      /* 无网络/未找到，用本地信息 */
    }
  }
  const authors = m.authors || 'Unknown'
  const year = m.year || new Date().getFullYear()
  const venue = m.venue || 'Unpublished'
  return [
    `@article{${key},`,
    `  title = {${paper.title}},`,
    `  author = {${authors}},`,
    `  journal = {${venue}},`,
    `  year = {${year}},`,
    m.doi ? `  doi = {${m.doi}},` : null,
    `  note = {Imported from LearnHub}`,
    `}`
  ]
    .filter(Boolean)
    .join('\n')
}

/** AI 生成论文一句话总结（可选） */
export async function aiSummarizeAbstract(title: string, firstPageText: string): Promise<string> {
  return aiAsk(
    `请用不超过 3 句话总结这篇论文的核心贡献。标题：${title}\n首页内容：\n${firstPageText.slice(0, 3000)}`,
    '你是学术助手，输出简洁中文。'
  )
}
