import type { Note, Paper } from '@/types'

export type ResearchSearchResult = {
  id: string
  kind: 'paper' | 'highlight' | 'explanation' | 'answer' | 'note'
  paperId?: string
  highlightId?: string
  noteId?: string
  title: string
  context: string
  page?: number
}

function includesQuery(value: unknown, query: string): boolean {
  return String(value ?? '').toLocaleLowerCase().includes(query)
}

function excerpt(value: unknown, query: string, max = 150): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const at = text.toLocaleLowerCase().indexOf(query)
  const start = Math.max(0, (at < 0 ? 0 : at) - Math.floor(max / 3))
  return `${start ? '…' : ''}${text.slice(start, start + max)}${start + max < text.length ? '…' : ''}`
}

/** Search user-owned research material. External search metadata is deliberately not included. */
export function searchResearch(query: string, papers: Paper[], notes: Note[], limit = 30): ResearchSearchResult[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return []
  const out: ResearchSearchResult[] = []
  const push = (item: ResearchSearchResult) => { if (out.length < limit) out.push(item) }

  for (const paper of papers) {
    if ([paper.title, paper.fileName, paper.meta?.authors, paper.meta?.doi, paper.meta?.year, paper.meta?.venue, ...(paper.tags ?? [])].some((v) => includesQuery(v, q))) {
      push({ id: `paper:${paper.id}`, kind: 'paper', paperId: paper.id, title: paper.title, context: [paper.meta?.authors, paper.meta?.year, paper.meta?.venue, paper.meta?.doi].filter(Boolean).join(' · ') || paper.fileName })
    }
    for (const h of [...(paper.highlights ?? [])].sort((a, b) => b.createdAt - a.createdAt)) {
      if (includesQuery(h.text, q)) push({ id: `highlight:${paper.id}:${h.id}`, kind: 'highlight', paperId: paper.id, highlightId: h.id, title: '原文标记', context: excerpt(h.text, q), page: h.page })
      if (h.note && includesQuery(h.note, q)) push({ id: `annotation:${paper.id}:${h.id}`, kind: 'highlight', paperId: paper.id, highlightId: h.id, title: '批注', context: excerpt(h.note, q), page: h.page })
      if (h.aiExplain && includesQuery(h.aiExplain, q)) push({ id: `explanation:${paper.id}:${h.id}`, kind: 'explanation', paperId: paper.id, highlightId: h.id, title: '已保存的 AI 解释', context: excerpt(h.aiExplain, q), page: h.page })
    }
    for (const a of [...(paper.answers ?? [])].sort((x, y) => y.createdAt - x.createdAt)) {
      if (![a.question, a.quote].some((v) => includesQuery(v, q))) continue
      push({ id: `answer:${paper.id}:${a.id}`, kind: 'answer', paperId: paper.id, title: a.question || '研究问答', context: excerpt(a.quote, q) || (a.source ? `来源链接：${a.source}` : '已保存的问答记录') })
    }
    for (const s of [...(paper.searches ?? [])].sort((a, b) => b.createdAt - a.createdAt)) {
      if (![s.query, s.boundText].some((v) => includesQuery(v, q))) continue
      push({ id: `search:${paper.id}:${s.id}`, kind: 'answer', paperId: paper.id, highlightId: s.sourceHighlightId, title: `研究问题：${s.query}`, context: excerpt(s.boundText || s.query, q) })
    }
  }

  for (const note of [...notes].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (![note.title, note.body, ...(note.tags ?? [])].some((v) => includesQuery(v, q))) continue
    push({ id: `note:${note.id}`, kind: 'note', paperId: note.paperId, noteId: note.id, title: note.title, context: excerpt([...(note.tags ?? [])].concat(note.body).filter(Boolean).join(' · '), q) })
  }
  return out
}
