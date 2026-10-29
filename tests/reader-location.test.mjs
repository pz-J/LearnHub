import test from 'node:test'
import assert from 'node:assert/strict'
import { clampReaderPage, legacyReaderPageKey, normalizeReaderLocation, readerLocationKey, resolveReaderPageRequest } from '../src/renderer/src/lib/readerLocation.ts'

test('reader checkpoint clamps page and scroll ratio to valid PDF bounds', () => {
  assert.deepEqual(normalizeReaderLocation({ page: 99.8, scrollRatio: 1.5, updatedAt: 12 }, 8), {
    page: 8, scrollRatio: 1, updatedAt: 12
  })
  assert.deepEqual(normalizeReaderLocation({ page: -4, scrollRatio: -1 }, 8), {
    page: 1, scrollRatio: 0, updatedAt: 0
  })
})

test('invalid or empty checkpoints safely fall back for legacy page-only data', () => {
  assert.equal(normalizeReaderLocation(null, 8), null)
  assert.equal(normalizeReaderLocation({ page: '3', scrollRatio: 0.2 }, 8), null)
  assert.equal(normalizeReaderLocation({ page: 2, scrollRatio: Number.NaN }, 8), null)
  assert.equal(normalizeReaderLocation({ page: 2, scrollRatio: 0.2 }, 0), null)
})

test('per-paper keys are isolated and preserve the legacy page key', () => {
  assert.equal(readerLocationKey('paper-a'), 'lh:reader-location:paper-a')
  assert.notEqual(readerLocationKey('paper-a'), readerLocationKey('paper-b'))
  assert.equal(legacyReaderPageKey('paper-a'), 'lh:lastpage:paper-a')
})

test('source page navigation clamps invalid and out-of-range legacy pages', () => {
  assert.equal(clampReaderPage(0, 18), 1)
  assert.equal(clampReaderPage(22, 18), 18)
  assert.equal(clampReaderPage(Number.NaN, 0), 1)
})

test('source page requests distinguish valid locations from corrected out-of-range locations', () => {
  assert.deepEqual(resolveReaderPageRequest(2, 2), { page: 2, clamped: false })
  assert.deepEqual(resolveReaderPageRequest(1.5, 2), { page: 1, clamped: true })
  assert.deepEqual(resolveReaderPageRequest(99, 2), { page: 2, clamped: true })
  assert.deepEqual(resolveReaderPageRequest(0, 2), { page: 1, clamped: true })
  assert.deepEqual(resolveReaderPageRequest(Number.NaN, 2), { page: 1, clamped: true })
})
