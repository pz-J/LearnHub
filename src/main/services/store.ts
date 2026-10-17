import { secureHandle } from './ipcSecurity'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import { assertNoSymlinkComponents, safeJoin, sanitizeId } from './securityValidation'
export { safeJoin, sanitizeId } from './securityValidation'

/** 数据目录布局：
 *  userData/data/          同步范围（JSON / Markdown）
 *  userData/files/         论文 PDF 原件（不同步）
 *  userData/module-storage/<id>.json  模块私有存储（打包为 module-storage.json 随同步上传/拉取）
 *  userData/module-grants.json       授权记录（不同步）
 *  userData/settings.json            应用设置含密钥（不同步）
 *  userData/sync-state.json          同步状态快照（不同步）
 */

export const dataDir = () => path.join(app.getPath('userData'), 'data')
const filesDir = () => path.join(app.getPath('userData'), 'files')
export const modStorageDir = () => path.join(app.getPath('userData'), 'module-storage')

function atomicWrite(file: string, content: string): void {
  const root = app.getPath('userData')
  assertNoSymlinkComponents(root, file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  assertNoSymlinkComponents(root, file)
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('拒绝覆盖符号链接文件')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const tmp = file + '.tmp-' + randomUUID()
  fs.writeFileSync(tmp, content, { encoding: 'utf-8', flag: 'wx' })
  assertNoSymlinkComponents(root, file)
  fs.renameSync(tmp, file)
}

export function readJsonFile(file: string): unknown | null {
  try {
    assertNoSymlinkComponents(app.getPath('userData'), file)
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

export function writeJsonFile(file: string, data: unknown): void {
  atomicWrite(file, JSON.stringify(data, null, 2))
}

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex')
}

/** rel -> 绝对路径，限制在 data/ 下 */
function dataFile(rel: string): string {
  const file = safeJoin(dataDir(), rel)
  assertNoSymlinkComponents(app.getPath('userData'), file)
  return file
}

function dataFileForMutation(rel: string): string {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('数据文件路径不能为空')
  const file = dataFile(rel)
  if (file === path.resolve(dataDir())) throw new Error('不能直接覆盖或删除数据根目录')
  return file
}

export function registerStoreIpc(): void {
  secureHandle('data:read', (_e, rel: string) => {
    const file = dataFile(rel)
    try {
      if (!fs.existsSync(file)) return null
      const raw = fs.readFileSync(file, 'utf-8')
      if (file.endsWith('.json')) return JSON.parse(raw)
      return raw
    } catch {
      return null
    }
  })

  secureHandle('data:write', (_e, rel: string, content: unknown) => {
    const file = dataFileForMutation(rel)
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) throw new Error('只能写入数据文件，不能覆盖目录')
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 10 * 1024 * 1024) throw new Error('数据内容无效或超过 10 MB')
    atomicWrite(file, text)
    return true
  })

  secureHandle('data:delete', (_e, rel: string) => {
    const file = dataFileForMutation(rel)
    if (fs.existsSync(file)) {
      if (!fs.statSync(file).isFile()) throw new Error('只能删除单个数据文件')
      fs.unlinkSync(file)
    }
    return true
  })

  secureHandle('data:list', (_e, relDir: string) => {
    const dir = dataFile(relDir)
    try {
      if (!fs.existsSync(dir)) return []
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name)
    } catch {
      return []
    }
  })

  // ---------- settings ----------
  const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

  secureHandle('settings:get', () => readJsonFile(settingsFile()))
  secureHandle('settings:set', (_e, patch: Record<string, unknown>) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Buffer.byteLength(JSON.stringify(patch) ?? '', 'utf8') > 1024 * 1024) {
      throw new Error('设置更新格式无效或超过 1 MB')
    }
    const cur = (readJsonFile(settingsFile()) as Record<string, unknown>) ?? {}
    const next = deepMerge(cur, patch)
    writeJsonFile(settingsFile(), next)
    return next
  })

  // ---------- grants ----------
  const grantsFile = () => path.join(app.getPath('userData'), 'module-grants.json')
  secureHandle('grants:get', () => readJsonFile(grantsFile()) ?? {})
  secureHandle('grants:set', (_e, obj: unknown) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('授权数据格式错误')
    const allowed = new Set(['storage.own', 'storage.data', 'files.pick', 'pdf.read', 'network.fetch', 'ai.invoke', 'calendar.write', 'reader.annotate', 'ui.panel', 'ui.theme', 'clipboard', 'notify', 'links.open', 'meta.escalate', 'achievements.award'])
    const entries = Object.entries(obj as Record<string, unknown>)
    if (entries.length > 500) throw new Error('授权模块数量过多')
    for (const [id, caps] of entries) {
      sanitizeId(id)
      if (!Array.isArray(caps) || caps.length > allowed.size || caps.some((cap) => typeof cap !== 'string' || !allowed.has(cap))) {
        throw new Error(`模块 ${id} 的授权能力格式错误`)
      }
    }
    writeJsonFile(grantsFile(), obj)
    return true
  })

  // ---------- 模块私有存储 ----------
  secureHandle('modstore:read', (_e, moduleId: string) => {
    const file = safeJoin(modStorageDir(), sanitizeId(moduleId) + '.json')
    assertNoSymlinkComponents(app.getPath('userData'), file)
    return readJsonFile(file)
  })
  secureHandle('modstore:write', (_e, moduleId: string, obj: unknown) => {
    const file = safeJoin(modStorageDir(), sanitizeId(moduleId) + '.json')
    assertNoSymlinkComponents(app.getPath('userData'), file)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Buffer.byteLength(JSON.stringify(obj) ?? '', 'utf8') > 1024 * 1024) {
      throw new Error('模块私有存储必须是对象且不超过 1 MB')
    }
    writeJsonFile(file, obj)
    return true
  })
  /** 列出全部模块私有存储（供 GitHub 同步收集；跳过非法命名或损坏文件） */
  secureHandle('modstore:listAll', () => {
    const dir = modStorageDir()
    assertNoSymlinkComponents(app.getPath('userData'), dir)
    if (!fs.existsSync(dir)) return []
    const out: { id: string; obj: Record<string, unknown> }[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('.')) continue
      try {
        const id = sanitizeId(entry.name.slice(0, -'.json'.length))
        const obj = readJsonFile(path.join(dir, entry.name))
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push({ id, obj: obj as Record<string, unknown> })
      } catch {
        /* 跳过非法或损坏的模块存储 */
      }
    }
    return out
  })

  // ---------- 同步状态 ----------
  const syncStateFile = () => path.join(app.getPath('userData'), 'sync-state.json')
  secureHandle('syncstate:get', () => readJsonFile(syncStateFile()) ?? {})
  secureHandle('syncstate:set', (_e, obj: unknown) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Buffer.byteLength(JSON.stringify(obj) ?? '', 'utf8') > 5 * 1024 * 1024) {
      throw new Error('同步状态格式无效或超过 5 MB')
    }
    writeJsonFile(syncStateFile(), obj)
    return true
  })
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const k of Object.keys(b)) {
    const bv = b[k]
    const av = out[k]
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && av && typeof av === 'object' && !Array.isArray(av)) {
      out[k] = deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>)
    } else {
      out[k] = bv
    }
  }
  return out
}

export { filesDir }
