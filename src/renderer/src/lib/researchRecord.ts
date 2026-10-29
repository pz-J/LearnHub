import type { Note } from '@/types'

export function researchSourceKey(paperId: string, page: number, text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  return `${paperId}:${page}:${normalized}`
}

export function researchSourceMarker(key: string): string {
  return `<!-- learnhub-source:${encodeURIComponent(key)} -->`
}

export function findResearchNote(notes: Note[], key: string): Note | undefined {
  const marker = researchSourceMarker(key)
  return notes.find((note) => String(note.body ?? '').includes(marker))
}

export function buildResearchNoteBody(args: { key: string; paperTitle: string; page: number; quote: string; explanation: string }): string {
  return [
    researchSourceMarker(args.key),
    `> 来源论文：${args.paperTitle}`,
    `> 原文页码：第 ${args.page} 页`,
    '',
    '## 原文片段',
    args.quote.trim(),
    '',
    '## AI 解释（用户主动保存；不是外部文献引用）',
    args.explanation.trim(),
    '',
    '## 我的研究问题 / 结论',
    '（在这里补充自己的判断、疑问或下一步验证计划。）',
    ''
  ].join('\n')
}
