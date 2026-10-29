import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeByKey } from '../src/renderer/src/lib/serialQueue.ts'
import { removeNoteDurably } from '../src/renderer/src/lib/noteRemoval.ts'

test('note removal waits behind an in-flight autosave and cannot be undone by its late disk write', async () => {
  const events = []
  let notes = { 'n1.md': { id: 'n1.md', body: 'old' } }
  let releaseWrite
  const writeGate = new Promise((resolve) => { releaseWrite = resolve })
  const write = serializeByKey('n1.md', async () => {
    events.push('write-start')
    await writeGate
    events.push('write-disk')
    notes = { ...notes, 'n1.md': { id: 'n1.md', body: 'new' } }
  })
  const remove = removeNoteDurably({
    id: 'n1.md', serialize: serializeByKey,
    removeFromDisk: async (id) => { events.push(`delete-disk:${id}`) },
    current: () => notes,
    publish: (next) => { events.push('publish-delete'); notes = next },
    emit: () => events.push('emit')
  })
  await Promise.resolve()
  assert.deepEqual(events, ['write-start'])
  releaseWrite()
  await Promise.all([write, remove])
  assert.deepEqual(events, ['write-start', 'write-disk', 'delete-disk:n1.md', 'publish-delete', 'emit'])
  assert.equal(Object.hasOwn(notes, 'n1.md'), false)
})

test('failed note deletion keeps the in-memory note so the user can retry', async () => {
  const existing = { 'n1.md': { id: 'n1.md', body: 'keep me' } }
  let visible = existing
  let emitted = false
  await assert.rejects(removeNoteDurably({
    id: 'n1.md', serialize: serializeByKey,
    removeFromDisk: async () => { throw new Error('disk unavailable') },
    current: () => visible,
    publish: (next) => { visible = next },
    emit: () => { emitted = true }
  }), /disk unavailable/)
  assert.equal(visible, existing)
  assert.equal(emitted, false)
})
