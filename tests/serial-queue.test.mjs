import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeByKey } from '../src/renderer/src/lib/serialQueue.ts'

test('writes for the same note run in order even when an earlier write rejects', async () => {
  const events = []
  const first = serializeByKey('note-a', async () => {
    events.push('first:start')
    await new Promise((resolve) => setTimeout(resolve, 15))
    events.push('first:fail')
    throw new Error('disk unavailable')
  })
  const second = serializeByKey('note-a', async () => {
    events.push('second:write')
    return 'latest'
  })
  await assert.rejects(first, /disk unavailable/)
  assert.equal(await second, 'latest')
  assert.deepEqual(events, ['first:start', 'first:fail', 'second:write'])
})

test('writes to different notes are not unnecessarily serialized', async () => {
  const events = []
  const slow = serializeByKey('note-slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    events.push('slow')
  })
  const fast = serializeByKey('note-fast', async () => { events.push('fast') })
  await Promise.all([slow, fast])
  assert.deepEqual(events, ['fast', 'slow'])
})
