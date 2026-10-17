import { secureHandle } from './ipcSecurity'
import { dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { safeJoin, sanitizeId } from './store'
import { assertNoSymlinkComponents, isExternalModuleId, validateInstallPayload } from './securityValidation'

const modulesDir = () => path.join(app.getPath('userData'), 'modules')
const MAX_FILE_SIZE = 2 * 1024 * 1024
const MAX_MODULE_SIZE = 8 * 1024 * 1024
const MAX_MODULE_FILES = 200
const SKIP_DIRS = new Set(['node_modules', '.git'])

function readModuleFiles(dir: string, base = '', budget = { count: 0, total: 0 }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    const rel = base ? base + '/' + entry.name : entry.name
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      Object.assign(out, readModuleFiles(full, rel, budget))
    } else if (entry.isFile()) {
      const st = fs.statSync(full)
      if (/\.(png|jpg|jpeg|gif|pdf|zip|exe|woff2?|ttf)$/i.test(entry.name)) continue
      if (st.size > MAX_FILE_SIZE) throw new Error(`模块文件过大: ${rel}`)
      budget.count += 1
      budget.total += st.size
      if (budget.count > MAX_MODULE_FILES) throw new Error(`模块文件数量超过 ${MAX_MODULE_FILES}`)
      if (budget.total > MAX_MODULE_SIZE) throw new Error('模块总大小超过 8 MB')
      out[rel] = fs.readFileSync(full, 'utf-8')
    }
  }
  return out
}

/** 读取单个模块文件夹（清单 + 文本文件），任何问题都抛错 */
function readModuleFromDir(dir: string): { manifest: unknown; files: Record<string, string> } {
  const mfPath = path.join(dir, 'module.json')
  if (!fs.existsSync(mfPath)) throw new Error('所选文件夹中没有 module.json')
  if (fs.lstatSync(mfPath).isSymbolicLink()) throw new Error('module.json 不能是符号链接')
  if (fs.statSync(mfPath).size > MAX_FILE_SIZE) throw new Error('module.json 超过 2 MB 限制')
  const manifest = JSON.parse(fs.readFileSync(mfPath, 'utf-8'))
  return { manifest, files: readModuleFiles(dir) }
}

export function registerModulesIpc(): void {
  /** 选择本地文件夹读取模块内容（不落盘，返回给渲染端走授权流程后安装） */
  secureHandle('modules:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择模块文件夹（需含 module.json）',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths.length) return null
    try {
      return readModuleFromDir(r.filePaths[0])
    } catch (err) {
      return { error: String((err as Error).message || err) }
    }
  })

  /** 批量读取：所选文件夹下每个含 module.json 的子文件夹视为一个模块（若所选文件夹本身就是模块则只读它） */
  secureHandle('modules:pick-batch', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择批量导入文件夹（其中每个子文件夹应为一个模块）',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths.length) return null
    const root = r.filePaths[0]
    const items: { folder: string; manifest: unknown; files: Record<string, string> }[] = []
    const errors: { folder: string; error: string }[] = []
    let scanned = 0
    const tryRead = (dir: string, label: string) => {
      scanned += 1
      try {
        const { manifest, files } = readModuleFromDir(dir)
        items.push({ folder: label, manifest, files })
      } catch (err) {
        const msg = String((err as Error).message || err)
        // 子文件夹缺少 module.json 视为非模块目录，静默跳过；其余问题（损坏清单/超限等）记录给用户
        if (msg !== '所选文件夹中没有 module.json') errors.push({ folder: label, error: msg })
      }
    }
    try {
      if (fs.existsSync(path.join(root, 'module.json'))) {
        tryRead(root, path.basename(root))
      } else {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
          tryRead(path.join(root, entry.name), entry.name)
        }
      }
    } catch (err) {
      return { error: String((err as Error).message || err) }
    }
    return { items, errors, scanned }
  })

  /** 列出已安装模块（含代码，用于沙箱注入） */
  secureHandle('modules:list', () => {
    const out: { id: string; manifest: unknown; files: Record<string, string> }[] = []
    try {
      assertNoSymlinkComponents(app.getPath('userData'), modulesDir())
      if (!fs.existsSync(modulesDir())) return out
      for (const entry of fs.readdirSync(modulesDir(), { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('core.')) continue
        const dir = path.join(modulesDir(), entry.name)
        const mfPath = path.join(dir, 'module.json')
        if (!fs.existsSync(mfPath)) continue
        try {
          assertNoSymlinkComponents(app.getPath('userData'), mfPath)
          const manifest = JSON.parse(fs.readFileSync(mfPath, 'utf-8'))
          out.push({ id: entry.name, manifest, files: readModuleFiles(dir) })
        } catch {
          /* 跳过损坏模块 */
        }
      }
    } catch {
      /* ignore */
    }
    return out
  })

  /** 安装（写入 userData/modules/<id>/） */
  secureHandle('modules:install', (_e, id: string, files: Record<string, string>) => {
    validateInstallPayload(id, files)
    const root = modulesDir()
    assertNoSymlinkComponents(app.getPath('userData'), root)
    fs.mkdirSync(root, { recursive: true })
    assertNoSymlinkComponents(app.getPath('userData'), root)
    const target = safeJoin(root, id)
    assertNoSymlinkComponents(app.getPath('userData'), target)
    const stage = fs.mkdtempSync(path.join(root, '.install-'))
    const backup = path.join(root, `.backup-${id}-${Date.now()}`)
    let movedOld = false
    try {
      for (const [rel, content] of Object.entries(files)) {
        const f = safeJoin(stage, rel)
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, content, 'utf-8')
      }
      if (fs.existsSync(target)) {
        fs.renameSync(target, backup)
        movedOld = true
      }
      try {
        fs.renameSync(stage, target)
      } catch (err) {
        if (movedOld && fs.existsSync(backup)) fs.renameSync(backup, target)
        throw err
      }
      if (movedOld) {
        try { fs.rmSync(backup, { recursive: true, force: true }) } catch { /* 保留备份供人工恢复，不影响已完成的更新 */ }
      }
      return true
    } catch (err) {
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true })
      throw err
    }
  })

  /** 卸载 */
  secureHandle('modules:uninstall', (_e, id: string) => {
    if (!isExternalModuleId(id)) throw new Error('不能卸载非法模块或 core.* 内置模块')
    const target = safeJoin(modulesDir(), id)
    assertNoSymlinkComponents(app.getPath('userData'), target)
    if (!fs.existsSync(target)) return true
    const manifestPath = safeJoin(target, 'module.json')
    assertNoSymlinkComponents(app.getPath('userData'), manifestPath)
    if (!fs.existsSync(manifestPath)) throw new Error('模块目录缺少清单，已保留目录供恢复')
    let manifest: { id?: unknown; type?: unknown }
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) } catch { throw new Error('模块清单损坏，已保留目录供恢复') }
    if (manifest.id !== id || (manifest.type !== 'feature' && manifest.type !== 'meta')) throw new Error('模块清单与目录不匹配，已保留目录供恢复')
    fs.rmSync(target, { recursive: true })
    return true
  })
}
