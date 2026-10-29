import { create } from 'zustand'
import { lh } from '@/lib/ipc'
import { validateManifest, type ModuleManifest } from './manifest'
import { useGrants } from './grants'
import { useSettings } from '@/stores/settings'
import { clearModuleReaderButtons } from '@/stores/readerState'
import { installWithGrantRollback, uninstallWithGrantRollback } from './moduleLifecycle'

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
    const grants = useGrants.getState()
    const previous = get().modules[m.id]
    const previousGrants = [...(grants.grants[m.id] ?? [])]
    const previousEnabled = previous?.enabled ?? deriveEnabled(m)
    await installWithGrantRollback({
      prepareGrants: async () => {
        // Updates discard optional grants; the new manifest's required permissions are explicit.
        await useGrants.getState().revokeAll(m.id)
        for (const p of m.permissions) await useGrants.getState().grant(m.id, p as never)
      },
      enable: () => persistEnabled(m.id, true),
      install: () => lh.modulesInstall(m.id, files),
      restoreGrants: async () => {
        await useGrants.getState().revokeAll(m.id)
        for (const cap of previousGrants) await useGrants.getState().grant(m.id, cap as never)
      },
      restoreEnabled: () => persistEnabled(m.id, previousEnabled)
    })
    clearModuleReaderButtons(m.id)
    const modules = { ...get().modules }
    modules[m.id] = { id: m.id, manifest: m, source: 'external', enabled: true, files }
    set({ modules })
  },
  uninstallExternal: async (id) => {
    const record = get().modules[id]
    if (!record || record.source !== 'external') return
    await persistEnabled(id, false)
    set({ modules: { ...get().modules, [id]: { ...record, enabled: false } } })
    clearModuleReaderButtons(id)
    const grantStore = useGrants.getState()
    try {
      await uninstallWithGrantRollback({
        id,
        previousGrants: [...(grantStore.grants[id] ?? [])],
        revokeAll: (moduleId) => useGrants.getState().revokeAll(moduleId),
        uninstall: (moduleId) => lh.modulesUninstall(moduleId),
        grant: (moduleId, capability) => useGrants.getState().grant(moduleId, capability as never)
      })
    } catch (error) {
      try {
        await persistEnabled(id, record.enabled)
        set({ modules: { ...get().modules, [id]: { ...record, enabled: record.enabled } } })
      } catch (restoreError) {
        throw new Error(`卸载失败，恢复模块启用状态也失败：${(restoreError as Error).message || '未知错误'}；原始错误：${(error as Error).message || '未知错误'}`)
      }
      throw error
    }
    const modules = { ...get().modules }
    delete modules[id]
    set({ modules })
  },
  setEnabled: async (id, enabled) => {
    const rec = get().modules[id]
    if (!rec) return
    await persistEnabled(id, enabled)
    if (!enabled) clearModuleReaderButtons(id)
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
