import test from 'node:test'
import assert from 'node:assert/strict'
import { installWithGrantRollback, uninstallWithGrantRollback } from '../src/renderer/src/kernel/moduleLifecycle.ts'

test('failed module uninstall restores all previously granted capabilities and rethrows the real failure', async () => {
  const events = []
  const original = new Error('filesystem denied')
  await assert.rejects(uninstallWithGrantRollback({
    id: 'com.example.module', previousGrants: ['ai.invoke', 'notify'],
    revokeAll: async (id) => events.push(`revoke:${id}`),
    uninstall: async (id) => { events.push(`uninstall:${id}`); throw original },
    grant: async (id, cap) => events.push(`grant:${id}:${cap}`)
  }), (error) => error === original)
  assert.deepEqual(events, [
    'revoke:com.example.module', 'uninstall:com.example.module',
    'grant:com.example.module:ai.invoke', 'grant:com.example.module:notify'
  ])
})

test('successful module uninstall does not restore stale grants', async () => {
  const events = []
  await uninstallWithGrantRollback({
    id: 'com.example.module', previousGrants: ['ai.invoke'],
    revokeAll: async () => events.push('revoke'),
    uninstall: async () => events.push('uninstall'),
    grant: async () => events.push('grant')
  })
  assert.deepEqual(events, ['revoke', 'uninstall'])
})

test('authorization restoration failure reports both failures instead of hiding a partially recovered uninstall', async () => {
  await assert.rejects(uninstallWithGrantRollback({
    id: 'com.example.module', previousGrants: ['ai.invoke'],
    revokeAll: async () => {},
    uninstall: async () => { throw new Error('cannot remove directory') },
    grant: async () => { throw new Error('cannot restore grant') }
  }), /卸载失败，且恢复原授权时也失败：cannot restore grant；原始错误：cannot remove directory/)
})

test('failed install/update restores prior grants and enabled state without publishing a new module record', async () => {
  const events = []
  const original = new Error('atomic file replacement failed')
  await assert.rejects(installWithGrantRollback({
    prepareGrants: async () => events.push('prepare-new-grants'),
    enable: async () => events.push('enable'),
    install: async () => { events.push('install'); throw original },
    restoreGrants: async () => events.push('restore-grants'),
    restoreEnabled: async () => events.push('restore-enabled')
  }), (error) => error === original)
  assert.deepEqual(events, ['prepare-new-grants', 'enable', 'install', 'restore-grants', 'restore-enabled'])
})

test('grant preparation failure also runs recovery and does not attempt to replace module files', async () => {
  const events = []
  await assert.rejects(installWithGrantRollback({
    prepareGrants: async () => { events.push('prepare'); throw new Error('grant store unavailable') },
    enable: async () => events.push('enable'),
    install: async () => events.push('install'),
    restoreGrants: async () => events.push('restore-grants'),
    restoreEnabled: async () => events.push('restore-enabled')
  }), /grant store unavailable/)
  assert.deepEqual(events, ['prepare', 'restore-grants', 'restore-enabled'])
})
