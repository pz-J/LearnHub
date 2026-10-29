import test from 'node:test'
import assert from 'node:assert/strict'
import { registerModuleTaskOnce } from '../src/renderer/src/lib/moduleTaskRegistration.ts'
import { serializeByKey } from '../src/renderer/src/lib/serialQueue.ts'

function fixture() {
  let state = { moduleTasks: [], label: 'preserve-other-state' }
  const calls = []
  const register = (fail = false) => registerModuleTaskOnce({
    moduleId: 'com.example.study-journal', taskId: 'daily-review',
    getState: () => state,
    createTask: () => ({ id: `id-${calls.length}`, moduleId: 'com.example.study-journal', taskId: 'daily-review', title: 'Review', claimed: false }),
    buildNext: (current, moduleTasks) => ({ ...current, moduleTasks }),
    persist: async (next) => { calls.push('persist'); if (fail) throw new Error('disk full'); calls.push(JSON.stringify(next.moduleTasks)) },
    publish: (next) => { calls.push('publish'); state = next },
    serialize: (operation) => serializeByKey('test-module-tasks', operation),
    maxRecords: 100
  })
  return { register, calls, get state() { return state } }
}

test('concurrent duplicate module task registrations create exactly one durable record', async () => {
  const f = fixture()
  const results = await Promise.all([f.register(), f.register(), f.register()])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(f.state.moduleTasks.length, 1)
  assert.equal(f.state.label, 'preserve-other-state')
  assert.equal(f.calls.filter((call) => call === 'publish').length, 1)
})

test('failed module task persistence leaves state unchanged and can be retried', async () => {
  const f = fixture()
  await assert.rejects(f.register(true), /disk full/)
  assert.equal(f.state.moduleTasks.length, 0)
  assert.deepEqual(f.calls, ['persist'])
  assert.equal(await f.register(), true)
  assert.equal(f.state.moduleTasks.length, 1)
  assert.equal(f.calls.at(-1), 'publish')
})
