import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { uninstallModuleDirectory } from '../src/main/services/moduleFilesystem.ts'
import { isExternalModuleId } from '../src/main/services/securityValidation.ts'

function withTempModules(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learnhub-module-test-'))
  try { return fn(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('module uninstall atomically removes the active path before cleaning its quarantine copy', () => {
  withTempModules((root) => {
    const target = path.join(root, 'com.example.study')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'module.json'), '{"id":"com.example.study"}')
    uninstallModuleDirectory(root, 'com.example.study', isExternalModuleId, { now: () => 123 })
    assert.equal(fs.existsSync(target), false)
    assert.equal(fs.existsSync(path.join(root, '.uninstall-com.example.study-123')), false)
  })
})

test('cleanup failure leaves an inactive hidden recovery copy instead of a partially deleted active module', () => {
  withTempModules((root) => {
    const target = path.join(root, 'com.example.study')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'module.json'), 'recoverable')
    uninstallModuleDirectory(root, 'com.example.study', isExternalModuleId, {
      // Keep using the production ID validator while simulating only cleanup failure.
      // The actual module is moved out of the active path before this callback runs.
      now: () => 456,
      rmSync: () => { throw new Error('simulated antivirus lock') }
    })
    assert.equal(fs.existsSync(target), false)
    assert.equal(fs.readFileSync(path.join(root, '.uninstall-com.example.study-456', 'module.json'), 'utf8'), 'recoverable')
  })
})

test('module uninstall refuses built-in or path-like identifiers before filesystem mutation', () => {
  withTempModules((root) => {
    assert.throws(() => uninstallModuleDirectory(root, 'core.example', isExternalModuleId), /不能卸载非法模块/)
    assert.throws(() => uninstallModuleDirectory(root, '..\\outside', isExternalModuleId), /不能卸载非法模块/)
    assert.deepEqual(fs.readdirSync(root), [])
  })
})
