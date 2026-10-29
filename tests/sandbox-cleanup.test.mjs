import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanupSandboxResources } from '../src/renderer/src/kernel/sandboxCleanup.ts'

test('sandbox cleanup deactivates first, aborts pending RPCs, and removes every event listener', () => {
  const events = []
  const requests = new Map([[1, new AbortController()], [2, new AbortController()]])
  const busUnsubs = new Map([
    ['reader:paper-opened', () => { events.push('paper-opened-off'); throw new Error('stale listener') }],
    ['reader:highlight-added', () => events.push('highlight-added-off')]
  ])
  const controllers = [...requests.values()]

  cleanupSandboxResources({
    deactivate: () => events.push('deactivate'),
    removeMessageListener: () => events.push('message-off'),
    requests,
    busUnsubs
  })

  assert.deepEqual(events, ['deactivate', 'message-off', 'paper-opened-off', 'highlight-added-off'])
  assert.ok(controllers.every((controller) => controller.signal.aborted))
  assert.equal(requests.size, 0)
  assert.equal(busUnsubs.size, 0)
})
