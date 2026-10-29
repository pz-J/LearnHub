import test from 'node:test'
import assert from 'node:assert/strict'
import { isActiveReaderRequest } from '../src/renderer/src/lib/readerRequest.ts'

test('PDF async results are accepted only while their original paper remains active', () => {
  assert.equal(isActiveReaderRequest(true, 'paper-a', 'paper-a'), true)
  assert.equal(isActiveReaderRequest(false, 'paper-a', 'paper-a'), false)
  assert.equal(isActiveReaderRequest(true, 'paper-a', 'paper-b'), false)
  assert.equal(isActiveReaderRequest(true, 'paper-a', null), false)
})

test('stale PDF failures after a rapid paper switch are not surfaced as errors for the new paper', () => {
  const notifications = []
  const handleFailure = (alive, requestedId, activeId, message) => {
    if (!isActiveReaderRequest(alive, requestedId, activeId)) return
    notifications.push(message)
  }
  handleFailure(true, 'paper-a', 'paper-b', 'paper-a failed')
  handleFailure(true, 'paper-b', 'paper-b', 'paper-b failed')
  assert.deepEqual(notifications, ['paper-b failed'])
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('a late successful PDF response cannot replace the newer paper after B finishes first', async () => {
  let activePaperId = 'paper-a'
  const accepted = []
  let aliveA = true
  const a = deferred()
  const b = deferred()
  const request = async (id, gate, alive) => {
    try {
      const doc = await gate.promise
      if (isActiveReaderRequest(alive(), id, activePaperId)) accepted.push(`${id}:${doc}`)
    } catch (error) {
      if (isActiveReaderRequest(alive(), id, activePaperId)) accepted.push(`${id}:error:${error.message}`)
    }
  }
  const pendingA = request('paper-a', a, () => aliveA)
  activePaperId = 'paper-b'
  aliveA = false
  let aliveB = true
  const pendingB = request('paper-b', b, () => aliveB)
  b.resolve('document-b')
  await pendingB
  a.resolve('document-a')
  await pendingA
  aliveB = false
  assert.deepEqual(accepted, ['paper-b:document-b'])
})

test('a late failure from an obsolete request cannot replace the current paper error state', async () => {
  let activePaperId = 'paper-a'
  let aliveA = true
  const outcomes = []
  const a = deferred()
  const b = deferred()
  const request = async (id, gate, isAlive) => {
    try {
      await gate.promise
    } catch (error) {
      if (isActiveReaderRequest(isAlive(), id, activePaperId)) outcomes.push(`${id}:${error.message}`)
    }
  }
  const pendingA = request('paper-a', a, () => aliveA)
  activePaperId = 'paper-b'
  aliveA = false
  const pendingB = request('paper-b', b, () => true)
  b.reject(new Error('B unavailable'))
  await pendingB
  a.reject(new Error('stale A failure'))
  await pendingA
  assert.deepEqual(outcomes, ['paper-b:B unavailable'])
})
