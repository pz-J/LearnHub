import { create } from 'zustand'
import { lh } from '@/lib/ipc'
import { validateManifest, type ModuleManifest } from './manifest'
import { useGrants } from './grants'
import { useSettings } from '@/stores/settings'

export interface ExternalFiles {
  [rel: string]: string
}

export interface ModuleRecord {
  id: string
  manifest: ModuleManifest
  source: 'builtin' | 'external'
  enabled: boolean
  files?: ExternalFiles
}

export interface ModulePanel {
  id: string
  moduleId: string
  title: string
  slot: string
}

export interface ModuleRoute {
  key: string
  moduleId: string
  title: string
}

interface RegistryState {
  modules: Record<string, ModuleRecord>
  loaded: boolean
  load: () => Promise<void>
  registerBuiltin: (manifest: ModuleManifest) => void
  installExternal: (m: ModuleManifest, files: ExternalFiles) => Promise<void>
  uninstallExternal: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  get: (id: string) => ModuleRecord | undefined
}

function deriveEnabled(manifest: ModuleManifest): boolean {
  const st = useSettings.getState().settings.moduleState
  return st?.[manifest.id] ?? true
}

async function persistEnabled(id: string, enabled: boolean): Promise<void> {
  const { settings, update } = useSettings.getState()
  await update({ moduleState: { ...(settings.moduleState ?? {}), [id]: enabled } })
}

export const useRegistry = create<RegistryState>((set, get) => ({
  modules: {},
  loaded: false,
  load: async () => {
    await useGrants.getState().load()
    const list = await lh.modulesList()
    const modules = { ...get().modules }
    for (const item of list) {
      const v = validateManifest(item.manifest)
      if (!v.ok) continue
      modules[v.manifest.id] = {
        id: v.manifest.id,
        manifest: v.manifest,
        source: 'external',
        enabled: deriveEnabled(v.manifest),
        files: item.files
      }
    }
    set({ modules, loaded: true })
  },
  registerBuiltin: (manifest) => {
    const modules = { ...get().modules }
    modules[manifest.id] = { id: manifest.id, manifest, source: 'builtin', enabled: deriveEnabled(manifest) }
    set({ modules })
  },
  installExternal: async (m, files) => {
    await lh.modulesInstall(m.id, files)
    const grants = useGrants.getState()
    // 更新模块后只保留新清单声明的必需权限；旧的可选授权必须重新审批。
    await grants.revokeAll(m.id)
    // 安装时声明的必需权限自动生效；可选权限待运行时审批
    for (const p of m.permissions) await grants.grant(m.id, p as never)
    const modules = { ...get().modules }
    modules[m.id] = { id: m.id, manifest: m, source: 'external', enabled: true, files }
    set({ modules })
    await persistEnabled(m.id, true)
  },
  uninstallExternal: async (id) => {
    await useGrants.getState().revokeAll(id)
    await lh.modulesUninstall(id)
    const modules = { ...get().modules }
    delete modules[id]
    set({ modules })
    await persistEnabled(id, false)
  },
  setEnabled: async (id, enabled) => {
    const rec = get().modules[id]
    if (!rec) return
    await persistEnabled(id, enabled)
    set({ modules: { ...get().modules, [id]: { ...rec, enabled } } })
  },
  get: (id) => get().modules[id]
}))

/** 从启用模块的清单推导侧边栏面板 */
export function modulePanels(): ModulePanel[] {
  const { modules } = useRegistry.getState()
  const out: ModulePanel[] = []
  for (const m of Object.values(modules)) {
    if (!m.enabled) continue
    for (const p of m.manifest.contributes?.panels ?? []) {
      if (p.slot === 'sidebar') out.push({ id: `${m.id}:panel`, moduleId: m.id, title: p.title, slot: p.slot })
    }
  }
  return out
}

/** 从启用模块的清单推导导航路由 */
export function moduleRoutes(): ModuleRoute[] {
  const { modules } = useRegistry.getState()
  const out: ModuleRoute[] = []
  for (const m of Object.values(modules)) {
    if (!m.enabled) continue
    for (const r of m.manifest.contributes?.routes ?? []) {
      out.push({ key: `mod:${m.id}:${r.key}`, moduleId: m.id, title: r.title })
    }
  }
  return out
}
