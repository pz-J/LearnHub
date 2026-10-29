import test from 'node:test'
import assert from 'node:assert/strict'
import { searchResearch } from '../src/renderer/src/lib/researchSearch.ts'
import { buildResearchNoteBody, findResearchNote, researchSourceKey } from '../src/renderer/src/lib/researchRecord.ts'

const paper = {
  id: 'p1', title: 'Spin orbit coupling in layered materials', fileName: 'paper.pdf',
  meta: { authors: 'A. Author', doi: '10.1234/example', year: '2025', venue: 'Journal of Tests' },
  tags: ['condensed matter'], highlights: [
    { id: 'h1', page: 7, text: 'Berry curvature controls transport', note: 'Need to verify this claim', aiExplain: 'Berry curvature behaves like a magnetic field in momentum space', createdAt: 3, rects: [], color: '#fff' }
  ], searches: [{ id: 's1', query: 'Berry curvature origin', boundText: 'Berry curvature controls transport', createdAt: 4, provider: 'scholar' }],
  answers: [{ id: 'a1', question: 'Why does spin orbit coupling matter?', quote: 'It couples spin to orbital motion', createdAt: 5, mapId: 'm1', nodeId: 'n1' }]
}

test('unified research search categorizes paper metadata, annotations, saved explanations, answers and notes with context', () => {
  const note = { id: 'n1.md', title: 'Experiment plan', tags: ['next step'], paperId: 'p1', updatedAt: 6, body: 'Test Berry curvature with a gate sweep.' }
  const results = searchResearch('berry curvature', [paper], [note])
  assert.deepEqual(new Set(results.map((r) => r.kind)), new Set(['highlight', 'explanation', 'answer', 'note']))
  const savedExplanation = searchResearch('magnetic field', [paper], []).find((r) => r.id === 'explanation:p1:h1')
  assert.equal(savedExplanation.page, 7)
  assert.equal(savedExplanation.highlightId, 'h1')
  assert.match(savedExplanation.context, /magnetic field/)
  assert.equal(results.find((r) => r.kind === 'note').noteId, 'n1.md')
})

test('unified search handles empty queries, case folding and bounded results', () => {
  assert.deepEqual(searchResearch('   ', [paper], []), [])
  assert.ok(searchResearch('SPIN ORBIT', [paper], []).some((r) => r.kind === 'paper'))
  assert.equal(searchResearch('berry', [paper], [], 1).length, 1)
})

test('saved search records retain source-highlight links and notes survive a missing paper record', () => {
  const withSearchSource = { ...paper, searches: [{ id: 's-linked', query: 'spin question', boundText: 'Berry curvature controls transport', sourceHighlightId: 'h1', createdAt: 8 }] }
  const searchHit = searchResearch('spin question', [withSearchSource], []).find((r) => r.id === 'search:p1:s-linked')
  assert.equal(searchHit.highlightId, 'h1')
  const orphanedNote = { id: 'orphan.md', title: 'Orphaned evidence', tags: undefined, paperId: 'deleted-paper', updatedAt: 0, body: 'Keep this user-authored conclusion.' }
  assert.equal(searchResearch('user-authored conclusion', [], [orphanedNote])[0].noteId, 'orphan.md')
})

test('research note provenance is stable and duplicate saves resolve to the existing note without replacing user conclusions', () => {
  const key = researchSourceKey('p1', 7, ' Berry   curvature controls transport ')
  assert.equal(key, researchSourceKey('p1', 7, 'berry curvature controls transport'))
  const body = buildResearchNoteBody({ key, paperTitle: paper.title, page: 7, quote: 'Berry curvature controls transport', explanation: 'An effective geometric field.' })
  const existing = { id: 'n-source.md', title: 'Saved research', tags: [], paperId: 'p1', updatedAt: 9, body: `${body}\n## My conclusion\nNeeds experimental confirmation.\n` }
  assert.equal(findResearchNote([existing], key)?.id, 'n-source.md')
  assert.match(existing.body, /Needs experimental confirmation/)
  assert.match(body, /第 7 页/)
  assert.match(body, /不是外部文献引用/)
})
