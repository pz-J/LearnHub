import { secureHandle } from './ipcSecurity'
import { app, shell, clipboard, Notification, BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { dataDir, modStorageDir, readJsonFile, safeJoin, sanitizeId } from './store'
import { assertNoSymlinkComponents, isExternalModuleId, isExternalModuleManifest, isModuleCapabilityGranted } from './securityValidation'

export function registerMiscIpc(): void {
  secureHandle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return true
  })

  // Fixed, explicitly granted module bridge. The renderer permission check is not trusted here:
  // the main process independently validates the installed manifest and persisted optional grant.
  secureHandle('module:openExternal', async (_e, moduleId: string, rawUrl: string) => {
    const id = sanitizeId(moduleId)
    if (!isExternalModuleId(id)) throw new Error('links.open 仅适用于外部模块')
    let url: URL
    try { url = new URL(rawUrl) } catch { throw new Error('外部链接格式无效') }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('模块只能打开不含凭据的 HTTPS 链接')

    const moduleDir = safeJoin(path.join(app.getPath('userData'), 'modules'), id)
    const manifestPath = safeJoin(moduleDir, 'module.json')
    assertNoSymlinkComponents(app.getPath('userData'), manifestPath)
    if (!fs.existsSync(manifestPath)) throw new Error('目标外部模块未安装')
    let manifest: { id?: unknown; type?: unknown; permissions?: unknown; optionalPermissions?: unknown }
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch { throw new Error('模块清单损坏，拒绝打开外部链接') }
    if (!isExternalModuleManifest(id, manifest)) throw new Error('模块清单与目录 ID 不匹配或格式无效')
    const required = Array.isArray(manifest.permissions) && manifest.permissions.includes('links.open')
    const optional = Array.isArray(manifest.optionalPermissions) && manifest.optionalPermissions.includes('links.open')
    if (!required && !optional) throw new Error('模块清单未声明 links.open 权限')
    const grants = readJsonFile(path.join(app.getPath('userData'), 'module-grants.json'))
    if (!isModuleCapabilityGranted(id, manifest, grants, 'links.open')) throw new Error('主进程未找到 links.open 授权记录')
    await shell.openExternal(url.href)
    return true
  })

  secureHandle('app:openDataDir', () => {
    shell.openPath(dataDir())
    return true
  })

  secureHandle('app:openModStorageDir', () => {
    shell.openPath(modStorageDir())
    return true
  })

  secureHandle('app:clipboardWrite', (_e, text: string) => {
    clipboard.writeText(text)
    return true
  })

  secureHandle('app:notify', (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
    return true
  })

  secureHandle('app:versions', () => ({
    app: process.env.npm_package_version || '0.1.0',
    electron: process.versions.electron,
    node: process.versions.node
  }))

  secureHandle('win:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
    return true
  })
}
