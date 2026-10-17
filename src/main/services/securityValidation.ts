import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fs from 'node:fs'

export function isTrustedRendererUrl(frameUrl: string, devUrl = process.env.ELECTRON_RENDERER_URL, expectedFilePath?: string): boolean {
  try {
    const actual = new URL(frameUrl)
    if (devUrl) {
      const expected = new URL(devUrl)
      return actual.origin === expected.origin && actual.pathname === expected.pathname
    }
    if (actual.protocol !== 'file:' || !expectedFilePath) return false
    const actualPath = path.resolve(fileURLToPath(actual))
    const expectedPath = path.resolve(expectedFilePath)
    return process.platform === 'win32' ? actualPath.toLowerCase() === expectedPath.toLowerCase() : actualPath === expectedPath
  } catch {
    return false
  }
}

export function safeJoin(base: string, rel: string): string {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new Error('非法路径')
  const root = path.resolve(base)
  const target = path.resolve(root, rel)
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('非法路径: ' + rel)
  return target
}

/** Reject symlinks anywhere between a trusted data root and a target path. */
export function assertNoSymlinkComponents(root: string, target: string): void {
  const rootPath = path.resolve(root)
  const targetPath = path.resolve(target)
  if (targetPath !== rootPath && !targetPath.startsWith(rootPath + path.sep)) throw new Error('路径超出受信任目录')
  const relative = path.relative(rootPath, targetPath)
  const parts = relative ? relative.split(path.sep).filter(Boolean) : []
  let current = rootPath
  const check = (candidate: string): boolean => {
    try {
      if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error('拒绝通过符号链接访问文件: ' + candidate)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  for (const part of parts) {
    current = path.join(current, part)
    if (!check(current)) break
  }
}

export function sanitizeId(id: string): string {
  if (typeof id !== 'string') throw new Error('非法模块ID')
  const value = id
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) || value === '.' || value === '..') throw new Error('非法模块ID')
  return value
}

export function isExternalModuleId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id) && !id.startsWith('core.')
}

export function isExternalModuleManifest(id: string, manifest: unknown): boolean {
  if (!isExternalModuleId(id) || !manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  const value = manifest as Record<string, unknown>
  return value.id === id && (value.type === 'feature' || value.type === 'meta') &&
    Array.isArray(value.permissions) && Array.isArray(value.optionalPermissions ?? [])
}

export function isSyncPathAllowed(filePath: string): boolean {
  if (!filePath || filePath.includes('\\') || filePath.includes(':') || filePath.startsWith('/') || filePath.includes('\0')) return false
  const parts = filePath.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return false
  if (['todos.json', 'schedule.json', 'flashcards.json', 'module-events.json', 'focus-log.json', 'achievements.json', 'tower.json', 'module-storage.json'].includes(filePath)) return true
  if (parts.length !== 2) return false
  const [dir, name] = parts
  if (dir === 'papers' || dir === 'mindmaps') return /^[a-zA-Z0-9._-]+\.json$/.test(name)
  if (dir === 'notes') return /^[a-zA-Z0-9._-]+\.md$/.test(name)
  return false
}

export function githubPutFailure(status: number, filePath: string, message?: string): string | null {
  if (status >= 200 && status < 300) return null
  return `GitHub 写入 ${filePath} 失败：HTTP ${status}${message ? ` (${message})` : ''}`
}

export function isModuleCapabilityGranted(
  moduleId: string,
  manifest: { permissions?: unknown; optionalPermissions?: unknown },
  grants: unknown,
  capability: string
): boolean {
  const required = Array.isArray(manifest.permissions) && manifest.permissions.includes(capability)
  const optional = Array.isArray(manifest.optionalPermissions) && manifest.optionalPermissions.includes(capability)
  if (!required && !optional) return false
  if (!grants || typeof grants !== 'object' || Array.isArray(grants)) return false
  const moduleGrants = (grants as Record<string, unknown>)[moduleId]
  return Array.isArray(moduleGrants) && moduleGrants.includes(capability)
}

const MAX_FILE_SIZE = 2 * 1024 * 1024
const MAX_MODULE_SIZE = 8 * 1024 * 1024
const MAX_MODULE_FILES = 200
const CAPABILITIES = new Set([
  'storage.own', 'storage.data', 'files.pick', 'pdf.read', 'network.fetch', 'ai.invoke',
  'calendar.write', 'reader.annotate', 'ui.panel', 'ui.theme', 'clipboard', 'notify', 'links.open', 'meta.escalate',
  'achievements.award'
])

export function validateInstallPayload(id: unknown, files: unknown): asserts files is Record<string, string> {
  if (!isExternalModuleId(id)) throw new Error('非法模块 ID 或 core.* 内置模块保留命名空间')
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('模块文件列表格式错误')
  const entries = Object.entries(files as Record<string, unknown>)
  if (!entries.length || entries.length > MAX_MODULE_FILES) throw new Error(`模块文件数量必须在 1 到 ${MAX_MODULE_FILES} 之间`)
  let total = 0
  for (const [rel, content] of entries) {
    if (!rel || rel.includes('\\') || rel.includes(':') || rel.includes('\0') || path.posix.isAbsolute(rel) || rel.split('/').some((part) => !part || part === '.' || part === '..' || part === '__proto__' || part === 'constructor' || part === 'prototype')) {
      throw new Error(`非法模块文件路径: ${rel}`)
    }
    if (typeof content !== 'string') throw new Error(`模块文件必须是文本: ${rel}`)
    const size = Buffer.byteLength(content, 'utf8')
    if (size > MAX_FILE_SIZE) throw new Error(`模块文件过大: ${rel}`)
    total += size
    if (total > MAX_MODULE_SIZE) throw new Error('模块总大小超过 8 MB')
  }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse((files as Record<string, string>)['module.json'])
  } catch {
    throw new Error('模块缺少有效的 module.json')
  }
  if (manifest.id !== id) throw new Error('安装目录 ID 与清单 ID 不一致')
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 100) throw new Error('模块名称无效')
  if (typeof manifest.version !== 'string' || manifest.version.length > 40) throw new Error('模块版本无效')
  if (typeof manifest.entry !== 'string' || !manifest.entry.endsWith('.js') || !Object.prototype.hasOwnProperty.call(files, manifest.entry)) throw new Error('模块入口必须是存在的 .js 文件')
  if (manifest.type !== 'feature' && manifest.type !== 'meta') throw new Error('模块 type 必须为 feature 或 meta')
  if (!Array.isArray(manifest.permissions) || !Array.isArray(manifest.optionalPermissions ?? [])) throw new Error('模块权限声明格式错误')
  for (const cap of [...manifest.permissions, ...(manifest.optionalPermissions as unknown[])]) {
    if (typeof cap !== 'string' || !CAPABILITIES.has(cap)) throw new Error(`未知模块权限: ${String(cap)}`)
    if (cap.startsWith('meta.') && manifest.type !== 'meta') throw new Error(`能力 ${cap} 仅元模块可声明`)
  }
  const requiredPermissions = manifest.permissions as string[]
  const optionalPermissions = (manifest.optionalPermissions ?? []) as string[]
  if (new Set(requiredPermissions).size !== requiredPermissions.length || new Set(optionalPermissions).size !== optionalPermissions.length || optionalPermissions.some((cap) => requiredPermissions.includes(cap))) {
    throw new Error('权限不能重复声明或同时列入必需和可选权限')
  }
  if (manifest.type === 'meta' && !requiredPermissions.includes('meta.escalate')) throw new Error('元模块必须声明必需权限 meta.escalate')
  if (manifest.network !== undefined) {
    const network = manifest.network as { allowedHosts?: unknown }
    if (!network || typeof network !== 'object' || !Array.isArray(network.allowedHosts) || network.allowedHosts.some((host) => typeof host !== 'string' || !host || host.length > 253 || /[\s/:?#@]/.test(host.replace(/^\*\./, '')))) {
      throw new Error('network.allowedHosts 格式错误')
    }
  }
  if (manifest.contributes !== undefined) {
    if (!manifest.contributes || typeof manifest.contributes !== 'object' || Array.isArray(manifest.contributes)) throw new Error('contributes 格式错误')
    const c = manifest.contributes as Record<string, unknown>
    if (c.panels !== undefined && (!Array.isArray(c.panels) || c.panels.length > 1 || c.panels.some((panel) => {
      if (!panel || typeof panel !== 'object' || Array.isArray(panel)) return true
      const value = panel as Record<string, unknown>
      return value.slot !== 'sidebar' || typeof value.title !== 'string' || !value.title.trim()
    }))) {
      throw new Error('contributes.panels 格式错误')
    }
    if (c.routes !== undefined && (!Array.isArray(c.routes) || c.routes.some((route) => {
      if (!route || typeof route !== 'object' || Array.isArray(route)) return true
      const value = route as Record<string, unknown>
      return !/^[a-zA-Z0-9._-]{1,64}$/.test(String(value.key ?? '')) || typeof value.title !== 'string' || !value.title.trim()
    }))) {
      throw new Error('contributes.routes 格式错误')
    }
    if (Array.isArray(c.routes)) {
      const keys = c.routes.map((route) => String((route as Record<string, unknown>).key))
      if (new Set(keys).size !== keys.length) throw new Error('contributes.routes 中的 key 不能重复')
    }
    if (c.commands !== undefined && (!Array.isArray(c.commands) || c.commands.some((command) => typeof command !== 'string'))) throw new Error('contributes.commands 格式错误')
  }
}
