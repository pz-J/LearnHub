import type { Note } from '@/types'

export interface ResearchActionDraft {
  title: string
  sourceKey: string
  sourceNoteId: string
  sourcePaperId?: string
  sourcePage?: number
}

export interface ResearchNoteSource {
  paperId?: string
  page: number
  quote: string
}

export function researchSourceFromNote(note: Note): ResearchNoteSource | null {
  const body = String(note.body ?? '')
  if (!body.includes('<!-- learnhub-source:')) return null
  const page = body.match(/^>\s*原文页码：第\s*(\d+)\s*页/m)
  const quote = body.match(/^##\s+原文片段\s*\n([\s\S]*?)(?=\n##\s|$)/m)?.[1]?.trim()
  if (!page || !quote) return null
  const encodedKey = body.match(/<!-- learnhub-source:([^>]+) -->/)?.[1]
  let paperId = note.paperId
  if (!paperId && encodedKey) {
    try { paperId = decodeURIComponent(encodedKey).match(/^(.+?):\d+:/)?.[1] } catch { /* malformed legacy source marker */ }
  }
  return { paperId, page: Number(page[1]), quote }
}

/** Derive a practical next step from a user-saved note without treating AI prose as confirmed evidence. */
export function researchActionFromNote(note: Note): ResearchActionDraft {
  const body = String(note.body ?? '')
  const section = body.split(/^##\s+我的研究问题\s*\/\s*结论\s*$/m)[1] ?? ''
  const candidate = section
    .split(/^##\s+/m)[0]
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)/, '').trim())
    .find((line) => line && !/[（(]在这里补充/.test(line))
  const title = candidate
    ? `研究行动：${candidate.replace(/^>\s*/, '').slice(0, 110)}`
    : `继续研究：${note.title || '未命名研究记录'}`
  const page = body.match(/^>\s*原文页码：第\s*(\d+)\s*页/m)
  return {
    title,
    sourceKey: `research-action:${note.id}`,
    sourceNoteId: note.id,
    sourcePaperId: note.paperId,
    sourcePage: page ? Number(page[1]) : undefined
  }
}
