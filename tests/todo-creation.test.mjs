import test from 'node:test'
import assert from 'node:assert/strict'
import { createTodoWithFeedback } from '../src/renderer/src/lib/todoCreation.ts'

test('quick task creation remains retryable and reports failure when persistence rejects', async () => {
  const events = []
  let attempts = 0
  const args = {
    title: '  Verify citation  ',
    add: async (title) => {
      attempts++
      events.push(`persist:${title}`)
      if (attempts === 1) throw new Error('disk full')
      return { id: 'todo-1', title }
    },
    onSuccess: (todo) => events.push(`success:${todo.id}`),
    onError: (error) => events.push(`error:${error.message}`)
  }

  assert.equal(await createTodoWithFeedback(args), false)
  assert.deepEqual(events, ['persist:Verify citation', 'error:disk full'])
  assert.equal(await createTodoWithFeedback(args), true)
  assert.deepEqual(events, ['persist:Verify citation', 'error:disk full', 'persist:Verify citation', 'success:todo-1'])
})

test('blank quick task is not persisted and does not announce success', async () => {
  let calls = 0
  assert.equal(await createTodoWithFeedback({
    title: '  ', add: async () => { calls++; return true }, onSuccess: () => assert.fail('unexpected success'), onError: () => assert.fail('unexpected error')
  }), false)
  assert.equal(calls, 0)
})
