import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { persistThenPublish } from '../src/renderer/src/lib/persistedWrite.ts'

const todoStore = await readFile(new URL('../src/renderer/src/stores/todos.ts', import.meta.url), 'utf8')

test('failed todo persistence never publishes optimistic state and a retry can commit', async () => {
  let visible = ['old']
  const next = ['old', 'new']
  await assert.rejects(persistThenPublish(next, async () => { throw new Error('disk full') }, (value) => { visible = value }), /disk full/)
  assert.deepEqual(visible, ['old'])
  await persistThenPublish(next, async () => {}, (value) => { visible = value })
  assert.deepEqual(visible, ['old', 'new'])
})

test('todo mutations serialize, deduplicate by stable research source, and publish after persistence', () => {
  assert.match(todoStore, /serializeByKey\('todos', async \(\) =>/)
  assert.match(todoStore, /current\.find\(\(item\) => item\.sourceKey === t\.sourceKey\)/)
  assert.match(todoStore, /persistThenPublish\(next, persist, \(items\) => set\(\{ items \}\)\)/)
})
