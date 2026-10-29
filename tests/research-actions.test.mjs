import test from 'node:test'
import assert from 'node:assert/strict'
import { researchActionFromNote, researchSourceFromNote } from '../src/renderer/src/lib/researchActions.ts'

const note = {
  id: 'n-research.md', title: 'Spin orbit coupling', tags: ['研究记录'], paperId: 'p-paper', updatedAt: 1,
  body: [
    '<!-- learnhub-source:p-paper%3A7%3Aspin%20orbit -->',
    '> 来源论文：Spin orbit coupling',
    '> 原文页码：第 7 页',
    '', '## 原文片段', 'Spin orbit coupling changes the band structure.',
    '', '## AI 解释（用户主动保存；不是外部文献引用）', 'A draft explanation.',
    '', '## 我的研究问题 / 结论', '验证 SOC 是否改变该样品的能带反转。', ''
  ].join('\n')
}

test('research note converts the user-written question into an idempotent action with source back-link metadata', () => {
  assert.deepEqual(researchActionFromNote(note), {
    title: '研究行动：验证 SOC 是否改变该样品的能带反转。',
    sourceKey: 'research-action:n-research.md', sourceNoteId: 'n-research.md', sourcePaperId: 'p-paper', sourcePage: 7
  })
  assert.deepEqual(researchSourceFromNote(note), { paperId: 'p-paper', page: 7, quote: 'Spin orbit coupling changes the band structure.' })
})

test('empty placeholder produces a follow-up draft without promoting AI prose to a confirmed conclusion', () => {
  const draft = researchActionFromNote({ ...note, body: note.body.replace('验证 SOC 是否改变该样品的能带反转。', '（在这里补充自己的判断、疑问或下一步验证计划。）') })
  assert.equal(draft.title, '继续研究：Spin orbit coupling')
  assert.equal(draft.sourceNoteId, note.id)
})

test('legacy research notes with missing optional fields remain readable and recover paper id from the source marker', () => {
  const { paperId, ...legacy } = note
  assert.deepEqual(researchSourceFromNote(legacy), { paperId: 'p-paper', page: 7, quote: 'Spin orbit coupling changes the band structure.' })
  assert.equal(researchActionFromNote({ id: 'legacy.md', title: undefined, body: undefined }).title, '继续研究：未命名研究记录')
})
