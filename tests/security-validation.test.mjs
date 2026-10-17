import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { assertNoSymlinkComponents, githubPutFailure, isExternalModuleId, isExternalModuleManifest, isModuleCapabilityGranted, isSyncPathAllowed, isTrustedRendererUrl, safeJoin, sanitizeId, validateInstallPayload } from '../src/main/services/securityValidation.ts'
import { canExternalEmit, canExternalSubscribe, isAllowedExternalUrl, isAllowedNetworkUrl, isCapabilityAllowed } from '../src/renderer/src/kernel/securityPolicy.ts'
import { isCapability } from '../src/renderer/src/kernel/permissions.ts'

function validModule() {
  return {
    'module.json': JSON.stringify({
      id: 'com.example.hello', name: 'Hello', version: '1.0.0', type: 'feature', entry: 'index.js',
      permissions: ['storage.own'], optionalPermissions: ['notify']
    }),
    'index.js': 'window.host.storage.get({})'
  }
}

function readModuleFolder(folderName) {
  const dir = new URL(`../modules/${folderName}/`, import.meta.url)
  const files = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.json'))) {
      files[entry.name] = readFileSync(new URL(entry.name, dir), 'utf8')
    }
  }
  const manifest = JSON.parse(files['module.json'])
  return { id: manifest.id, files }
}

test('renderer IPC trust accepts only the expected top-level renderer URL', () => {
  assert.equal(isTrustedRendererUrl('file:///C:/app/out/renderer/index.html', '', 'C:/app/out/renderer/index.html'), true)
  assert.equal(isTrustedRendererUrl('https://example.com/index.html', '', 'C:/app/out/renderer/index.html'), false)
  assert.equal(isTrustedRendererUrl('file:///C:/app/out/renderer/other.html', '', 'C:/app/out/renderer/index.html'), false)
  assert.equal(isTrustedRendererUrl('file:///C:/evil/renderer/index.html', '', 'C:/app/out/renderer/index.html'), false)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/', 'http://localhost:5173/'), true)
  assert.equal(isTrustedRendererUrl('http://evil.test/', 'http://localhost:5173/'), false)
})

test('safeJoin rejects traversal and sibling-prefix escapes', () => {
  assert.equal(safeJoin('C:/learnhub/data', 'notes/a.md').replaceAll('\\', '/'), 'C:/learnhub/data/notes/a.md')
  assert.throws(() => safeJoin('C:/learnhub/data', '../secrets.json'), /非法路径/)
  assert.throws(() => safeJoin('/tmp/data', '/tmp/data-evil/file'), /非法路径/)
  assert.throws(() => safeJoin('/tmp/data', 'bad\0name'), /非法路径/)
})

test('managed file access rejects symlinked subdirectories', (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'learnhub-path-test-'))
  const root = path.join(temp, 'userdata')
  const outside = path.join(temp, 'outside')
  mkdirSync(root); mkdirSync(outside)
  try {
    symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    t.skip('当前环境不允许创建目录符号链接：' + error.message)
    return
  }
  try {
    assert.throws(() => assertNoSymlinkComponents(root, path.join(root, 'linked', 'secret.json')), /符号链接/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('module IDs are validated rather than silently normalized', () => {
  assert.equal(sanitizeId('com.example.module'), 'com.example.module')
  assert.throws(() => sanitizeId('../module'), /非法模块ID/)
  assert.throws(() => sanitizeId('module/name'), /非法模块ID/)
  assert.equal(isExternalModuleId('com.example.module'), true)
  assert.equal(isExternalModuleId('core.calendar'), false)
  assert.equal(isExternalModuleId('../module'), false)
})

test('optional grants work only while the current manifest still declares the capability', () => {
  assert.equal(isCapabilityAllowed({ permissions: ['storage.own'], optionalPermissions: ['notify'] }, 'storage.own', []), true)
  assert.equal(isCapabilityAllowed({ permissions: [], optionalPermissions: ['notify'] }, 'notify', ['notify']), true)
  assert.equal(isCapabilityAllowed({ permissions: [], optionalPermissions: ['notify'] }, 'notify', []), false)
  assert.equal(isCapabilityAllowed({ permissions: [], optionalPermissions: [] }, 'notify', ['notify']), false)
})

test('only implemented capabilities appear in the active permission catalog', () => {
  assert.equal(isCapability('links.open'), true)
  assert.equal(isCapability('meta.bridge'), false)
  assert.equal(isCapability('github.sync'), false)
})

test('external modules can only subscribe to approved events and emit approved requests', () => {
  assert.equal(canExternalSubscribe('focus:done'), true)
  assert.equal(canExternalSubscribe('reader:selection-changed'), false)
  assert.equal(canExternalSubscribe('*'), false)
  assert.equal(canExternalEmit('search:open'), true)
  assert.equal(canExternalEmit('reader:selection-changed'), false)
  assert.equal(canExternalEmit('sync:done'), false)
})

test('module network requests require HTTPS, no embedded credentials, and a matching host rule', () => {
  const hosts = ['api.crossref.org', '*.example.org']
  assert.equal(isAllowedNetworkUrl('https://api.crossref.org/works', hosts), true)
  assert.equal(isAllowedNetworkUrl('https://sub.example.org/data', hosts), true)
  assert.equal(isAllowedNetworkUrl('https://example.org/data', hosts), true)
  assert.equal(isAllowedNetworkUrl('http://api.crossref.org/works', hosts), false)
  assert.equal(isAllowedNetworkUrl('https://user:pass@api.crossref.org/works', hosts), false)
  assert.equal(isAllowedNetworkUrl('https://api.crossref.org.evil.test/works', hosts), false)
  assert.equal(isAllowedNetworkUrl('https://evil.test/works', hosts), false)
})

test('module external-link opening accepts only credential-free HTTPS URLs', () => {
  assert.equal(isAllowedExternalUrl('https://doi.org/10.1000/example'), true)
  assert.equal(isAllowedExternalUrl('http://doi.org/10.1000/example'), false)
  assert.equal(isAllowedExternalUrl('https://user:pass@doi.org/10.1000/example'), false)
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
})

test('main-process capability checks require both an optional declaration and a persisted grant', () => {
  assert.equal(isModuleCapabilityGranted('m', { permissions: ['links.open'] }, {}, 'links.open'), false)
  assert.equal(isModuleCapabilityGranted('m', { permissions: ['links.open'] }, { m: ['links.open'] }, 'links.open'), true)
  assert.equal(isModuleCapabilityGranted('m', { permissions: [], optionalPermissions: ['links.open'] }, { m: ['links.open'] }, 'links.open'), true)
  assert.equal(isModuleCapabilityGranted('m', { permissions: [], optionalPermissions: ['links.open'] }, {}, 'links.open'), false)
  assert.equal(isModuleCapabilityGranted('m', { permissions: [], optionalPermissions: [] }, { m: ['links.open'] }, 'links.open'), false)
})

test('main-process module bridge rejects mismatched or malformed installed manifests', () => {
  assert.equal(isExternalModuleManifest('com.example.reader', { id: 'com.example.reader', type: 'feature', permissions: [], optionalPermissions: ['links.open'] }), true)
  assert.equal(isExternalModuleManifest('com.example.reader', { id: 'another.module', type: 'feature', permissions: [], optionalPermissions: ['links.open'] }), false)
  assert.equal(isExternalModuleManifest('com.example.reader', { id: 'com.example.reader', type: 'unknown', permissions: [], optionalPermissions: ['links.open'] }), false)
  assert.equal(isExternalModuleManifest('core.calendar', { id: 'core.calendar', type: 'feature', permissions: [], optionalPermissions: ['links.open'] }), false)
})

test('GitHub sync is limited to LearnHub data files and rejects path traversal or repository metadata', () => {
  assert.equal(isSyncPathAllowed('todos.json'), true)
  assert.equal(isSyncPathAllowed('papers/p_123.json'), true)
  assert.equal(isSyncPathAllowed('notes/n_123.md'), true)
  assert.equal(isSyncPathAllowed('../.github/workflows/build.yml'), false)
  assert.equal(isSyncPathAllowed('.github/workflows/build.yml'), false)
  assert.equal(isSyncPathAllowed('notes/../../secret.md'), false)
  assert.equal(isSyncPathAllowed('papers/evil.json/extra'), false)
  assert.equal(isSyncPathAllowed('module-storage/private.json'), false)
})

test('GitHub file writes treat non-2xx responses as failures', () => {
  assert.equal(githubPutFailure(201, 'todos.json'), null)
  assert.match(githubPutFailure(409, 'todos.json', 'sha mismatch'), /HTTP 409.*sha mismatch/)
  assert.match(githubPutFailure(500, 'notes/n_1.md'), /GitHub 写入 notes\/n_1\.md 失败/)
})

test('valid module install payload is accepted', () => {
  assert.doesNotThrow(() => validateInstallPayload('com.example.hello', validModule()))
})

test('module installation rejects path traversal, mismatched IDs, missing entry and unknown capabilities', () => {
  const traversal = validModule()
  traversal['../outside.js'] = 'no'
  assert.throws(() => validateInstallPayload('com.example.hello', traversal), /非法模块文件路径/)

  const mismatch = validModule()
  mismatch['module.json'] = JSON.stringify({ ...JSON.parse(mismatch['module.json']), id: 'another.module' })
  assert.throws(() => validateInstallPayload('com.example.hello', mismatch), /ID 不一致/)

  const missingEntry = validModule()
  missingEntry['module.json'] = JSON.stringify({ ...JSON.parse(missingEntry['module.json']), entry: 'missing.js' })
  assert.throws(() => validateInstallPayload('com.example.hello', missingEntry), /入口必须是存在的/)

  const unknownPermission = validModule()
  unknownPermission['module.json'] = JSON.stringify({ ...JSON.parse(unknownPermission['module.json']), permissions: ['system.root'] })
  assert.throws(() => validateInstallPayload('com.example.hello', unknownPermission), /未知模块权限/)

  const reservedPermission = validModule()
  reservedPermission['module.json'] = JSON.stringify({ ...JSON.parse(reservedPermission['module.json']), optionalPermissions: ['meta.bridge'] })
  assert.throws(() => validateInstallPayload('com.example.hello', reservedPermission), /未知模块权限/)

  const invalidMetaCapability = validModule()
  invalidMetaCapability['module.json'] = JSON.stringify({ ...JSON.parse(invalidMetaCapability['module.json']), optionalPermissions: ['meta.bridge'] })
  assert.throws(() => validateInstallPayload('com.example.hello', invalidMetaCapability), /未知模块权限/)

  assert.throws(() => validateInstallPayload('core.calendar', validModule()), /保留命名空间/)
  const prototypePath = validModule()
  prototypePath['__proto__/polluted.js'] = 'no'
  assert.throws(() => validateInstallPayload('com.example.hello', prototypePath), /非法模块文件路径/)

  const duplicateRoutes = validModule()
  duplicateRoutes['module.json'] = JSON.stringify({ ...JSON.parse(duplicateRoutes['module.json']), contributes: { routes: [{ key: 'a', title: 'A' }, { key: 'a', title: 'Again' }] } })
  assert.throws(() => validateInstallPayload('com.example.hello', duplicateRoutes), /key 不能重复/)
})

test('module installation enforces file and aggregate size limits', () => {
  const oversizedFile = validModule()
  oversizedFile['index.js'] = 'x'.repeat(2 * 1024 * 1024 + 1)
  assert.throws(() => validateInstallPayload('com.example.hello', oversizedFile), /文件过大/)

  const oversizedTotal = validModule()
  for (let i = 0; i < 5; i++) oversizedTotal[`file-${i}.txt`] = 'x'.repeat(1.7 * 1024 * 1024)
  assert.throws(() => validateInstallPayload('com.example.hello', oversizedTotal), /总大小超过/)
})

test('the example, research journal and meta permission manager manifests pass host installation validation', () => {
  for (const folder of ['example-hello', 'com-learnhub-study-journal', 'com-learnhub-meta-permission-center']) {
    const module = readModuleFolder(folder)
    assert.doesNotThrow(() => validateInstallPayload(module.id, module.files), `${folder} should be installable`)
    assert.doesNotThrow(() => new vm.Script(module.files['index.js'], { filename: `${folder}/index.js` }), `${folder} entry should parse`)
  }
})
