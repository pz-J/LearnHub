import test from 'node:test'
import assert from 'node:assert/strict'
import { commitRewardClaim } from '../src/renderer/src/lib/rewardTransaction.ts'

test('reward claim persists first, grants second, and publishes only after both writes succeed', async () => {
  const events = []
  const previous = { claimedIds: [], customTasks: [] }
  const next = { claimedIds: ['a-paper-1'], customTasks: [] }
  let visible = previous
  await commitRewardClaim({
    previous, next,
    persist: async (value) => events.push(`persist:${value.claimedIds.length}`),
    grant: async () => events.push('grant'),
    publish: (value) => { events.push('publish'); visible = value }
  })
  assert.deepEqual(events, ['persist:1', 'grant', 'publish'])
  assert.equal(visible, next)
})

test('failed reward write restores durable claim state and leaves visible state unchanged for retry', async () => {
  const events = []
  const previous = { claimedIds: [], customTasks: [] }
  const next = { claimedIds: ['a-paper-1'], customTasks: [] }
  let visible = previous
  let grantAttempts = 0
  const args = {
    previous, next,
    persist: async (value) => events.push(`persist:${value.claimedIds.length}`),
    grant: async () => { grantAttempts++; events.push('grant'); if (grantAttempts === 1) throw new Error('tower disk full') },
    publish: (value) => { events.push('publish'); visible = value }
  }
  await assert.rejects(commitRewardClaim(args), /tower disk full/)
  assert.deepEqual(events, ['persist:1', 'grant', 'persist:0'])
  assert.equal(visible, previous)
  await commitRewardClaim(args)
  assert.deepEqual(events, ['persist:1', 'grant', 'persist:0', 'persist:1', 'grant', 'publish'])
  assert.equal(visible, next)
})

test('failed rollback is surfaced with both reward and rollback failures and never publishes success', async () => {
  const previous = { claimedIds: [] }
  const next = { claimedIds: ['a-paper-1'] }
  let writes = 0
  let published = false
  await assert.rejects(commitRewardClaim({
    previous, next,
    persist: async () => { writes++; if (writes === 2) throw new Error('rollback disk full') },
    grant: async () => { throw new Error('tower disk full') },
    publish: () => { published = true }
  }), /奖励发放失败，且领取状态回滚失败：rollback disk full；原始错误：tower disk full/)
  assert.equal(published, false)
})

test('claim-record persistence failure never attempts to grant a reward', async () => {
  let grants = 0
  let published = false
  await assert.rejects(commitRewardClaim({
    previous: { claimedIds: [] }, next: { claimedIds: ['a-paper-1'] },
    persist: async () => { throw new Error('claim disk full') },
    grant: async () => { grants++ },
    publish: () => { published = true }
  }), /claim disk full/)
  assert.equal(grants, 0)
  assert.equal(published, false)
})
