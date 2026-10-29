import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveReaderHighlight } from '../src/renderer/src/lib/readerLocation.ts'

test('highlight deep-links resolve the exact stored mark and its valid page', () => {
  const highlights = [{ id: 'h1', page: 2, text: 'evidence' }, { id: 'h2', page: 3, text: 'another' }]
  assert.deepEqual(resolveReaderHighlight(highlights, 'h2', 3), {
    kind: 'located', highlight: highlights[1], page: 3, pageClamped: false
  })
})

test('deleted highlight references are distinguishable from valid links', () => {
  assert.deepEqual(resolveReaderHighlight([{ id: 'h1', page: 1 }], 'deleted-mark', 2), { kind: 'missing' })
})

test('legacy highlights pointing past the PDF page count are clamped and marked imprecise', () => {
  assert.deepEqual(resolveReaderHighlight([{ id: 'legacy', page: 99 }], 'legacy', 2), {
    kind: 'located', highlight: { id: 'legacy', page: 99 }, page: 2, pageClamped: true
  })
})
