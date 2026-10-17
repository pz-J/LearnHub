import type { Capability } from './permissions'
import { isCapability } from './permissions'

export interface ModuleManifest {
  id: string
  name: string
  version: string
  type: 'feature' | 'meta'
  entry: string
  description?: string
  author?: string
  permissions: string[]
  optionalPermissions?: string[]
  network?: { allowedHosts: string[] }
  contributes?: {
    panels?: { slot: 'sidebar'; title: string }[]
    routes?: { key: string; title: string }[]
    commands?: string[]
  }
  builtin?: boolean
}

export function validateManifest(m: unknown): { ok: true; manifest: ModuleManifest } | { ok: false; error: string } {
  if (!m || typeof m !== 'object') return { ok: false, error: '清单不是对象' }
  const mm = m as Record<string, unknown>
  for (const k of ['id', 'name', 'version', 'type', 'entry']) {
    if (typeof mm[k] !== 'string' || !(mm[k] as string).trim()) return { ok: false, error: `缺少字段 ${k}` }
  }
  if (!/^([a-zA-Z0-9][a-zA-Z0-9._-]{0,99})$/.test(mm.id as string)) return { ok: false, error: '模块 id 只能包含字母数字 . _ -，且不超过 100 个字符' }
  if ((mm.name as string).length > 100 || (mm.version as string).length > 40) return { ok: false, error: '模块名称或版本过长' }
  if (mm.type !== 'feature' && mm.type !== 'meta') return { ok: false, error: 'type 必须是 feature 或 meta' }
  const entry = mm.entry as string
  if (!entry.endsWith('.js') || entry.includes('\\') || entry.includes(':') || entry.startsWith('/') || entry.split('/').some((part) => !part || part === '.' || part === '..')) {
    return { ok: false, error: 'entry 必须是模块目录内的相对文件路径' }
  }
  if (!Array.isArray(mm.permissions) || mm.permissions.some((p) => typeof p !== 'string')) return { ok: false, error: 'permissions 必须是字符串数组' }
  if (mm.optionalPermissions !== undefined && (!Array.isArray(mm.optionalPermissions) || mm.optionalPermissions.some((p) => typeof p !== 'string'))) {
    return { ok: false, error: 'optionalPermissions 必须是字符串数组' }
  }
  const perms = mm.permissions as string[]
  for (const p of perms) {
    if (!isCapability(p)) return { ok: false, error: `未知能力: ${p}` }
    if (p.startsWith('meta.') && mm.type !== 'meta') return { ok: false, error: `能力 ${p} 仅元模块可声明` }
  }
  const opt = Array.isArray(mm.optionalPermissions) ? (mm.optionalPermissions as string[]) : []
  for (const p of opt) {
    if (!isCapability(p)) return { ok: false, error: `未知可选能力: ${p}` }
    if (p.startsWith('meta.') && mm.type !== 'meta') return { ok: false, error: `能力 ${p} 仅元模块可声明` }
  }
  if (new Set(perms).size !== perms.length || new Set(opt).size !== opt.length || opt.some((p) => perms.includes(p))) return { ok: false, error: '权限不能重复声明或同时列入必需和可选权限' }
  if (mm.type === 'meta' && !perms.includes('meta.escalate')) return { ok: false, error: '元模块必须声明必需权限 meta.escalate' }
  let network: ModuleManifest['network']
  if (mm.network !== undefined) {
    if (!mm.network || typeof mm.network !== 'object' || Array.isArray(mm.network)) return { ok: false, error: 'network 格式错误' }
    const hosts = (mm.network as Record<string, unknown>).allowedHosts
    if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== 'string' || !h || h.length > 253 || /[\s/:?#@]/.test(h.replace(/^\*\./, '')))) {
      return { ok: false, error: 'network.allowedHosts 必须是域名数组' }
    }
    network = { allowedHosts: hosts as string[] }
  }
  let contributes: ModuleManifest['contributes']
  if (mm.contributes !== undefined) {
    if (!mm.contributes || typeof mm.contributes !== 'object' || Array.isArray(mm.contributes)) return { ok: false, error: 'contributes 格式错误' }
    const c = mm.contributes as Record<string, unknown>
    if (c.panels !== undefined && (!Array.isArray(c.panels) || c.panels.some((p) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return true
      const panel = p as Record<string, unknown>
      return panel.slot !== 'sidebar' || typeof panel.title !== 'string' || !panel.title.trim()
    }))) return { ok: false, error: 'contributes.panels 格式错误' }
    if (c.routes !== undefined && (!Array.isArray(c.routes) || c.routes.some((r) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return true
      const route = r as Record<string, unknown>
      return !/^[a-zA-Z0-9._-]{1,64}$/.test(String(route.key ?? '')) || typeof route.title !== 'string' || !route.title.trim()
    }))) return { ok: false, error: 'contributes.routes 格式错误' }
    if (Array.isArray(c.panels) && c.panels.length > 1) return { ok: false, error: '每个模块当前只支持一个侧栏面板' }
    if (Array.isArray(c.routes)) {
      const routeKeys = c.routes.map((r) => String((r as Record<string, unknown>).key))
      if (new Set(routeKeys).size !== routeKeys.length) return { ok: false, error: 'contributes.routes 中的 key 不能重复' }
    }
    if (c.commands !== undefined && (!Array.isArray(c.commands) || c.commands.some((command) => typeof command !== 'string'))) return { ok: false, error: 'contributes.commands 格式错误' }
    contributes = c as ModuleManifest['contributes']
  }
  const manifest: ModuleManifest = {
    id: mm.id as string,
    name: mm.name as string,
    version: mm.version as string,
    type: mm.type as 'feature' | 'meta',
    entry,
    description: typeof mm.description === 'string' ? mm.description : '',
    author: typeof mm.author === 'string' ? mm.author : '',
    permissions: perms,
    optionalPermissions: opt,
    network,
    contributes
  }
  return { ok: true, manifest }
}
