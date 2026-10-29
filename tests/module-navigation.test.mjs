import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../modules/com-learnhub-vocab-box/module.json', import.meta.url), 'utf8'))
const navSource = await readFile(new URL('../src/renderer/src/components/layout/NavBar.tsx', import.meta.url), 'utf8')
const registrySource = await readFile(new URL('../src/renderer/src/kernel/registry.ts', import.meta.url), 'utf8')
const grantsSource = await readFile(new URL('../src/renderer/src/kernel/grants.ts', import.meta.url), 'utf8')
const hubSource = await readFile(new URL('../src/renderer/src/components/hub/ModuleHub.tsx', import.meta.url), 'utf8')

test('full-feature vocabulary module contributes a global route instead of a reader sidebar panel', () => {
  assert.deepEqual(manifest.contributes.routes, [{ key: 'vocab-box', title: '生词本' }])
  assert.equal(manifest.contributes.panels, undefined)
})

test('global navigation derives visible module routes from enabled registry records', () => {
  assert.match(registrySource, /export function moduleRoutes\(\)/)
  assert.match(registrySource, /if \(!m\.enabled\) continue/)
  assert.match(registrySource, /for \(const r of m\.manifest\.contributes\?\.routes \?\? \[\]\)/)
  assert.match(navSource, /\.\.\.modRoutes\.map\(\(r\) => \(\{ key: r\.key, title: r\.title \}\)\)/)
})

test('grant and revoke mutations serialize together and only publish after persistence succeeds', () => {
  assert.equal((grantsSource.match(/serializeByKey\('module-grants'/g) ?? []).length, 3)
  assert.match(grantsSource, /await persist\(next\)\s+set\(\{ grants: next \}\)/)
  assert.doesNotMatch(grantsSource, /set\(\{ grants: next \}\)\s+await persist\(next\)/)
})

test('permission revocation reports both persisted success and persistence failure to the user', () => {
  assert.match(hubSource, /const revokeCapability = async \(moduleId: string, capability: Capability\) => \{[\s\S]*?await revoke\(moduleId, capability\)[\s\S]*?toast\('已撤销该权限', 'ok'\)[\s\S]*?catch \(e\)[\s\S]*?toast\(`权限撤销失败：/)
  assert.match(hubSource, /onClick=\{\(\) => void revokeCapability\(m\.id, c as Capability\)\}/)
})
