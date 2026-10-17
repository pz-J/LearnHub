import { create } from 'zustand'
import type { Settings } from '@/types'
import { defaultSettings } from '@/types'
import { lh } from '@/lib/ipc'

function merge<T>(base: T, patch: Partial<T> | null | undefined): T {
  if (!patch) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    const bv = (base as Record<string, unknown>)[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = merge(bv, v as Partial<unknown>)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettings(),
  loaded: false,
  load: async () => {
    const saved = (await lh.settingsGet()) as Partial<Settings> | null
    const settings = merge(defaultSettings(), saved)
    set({ settings, loaded: true })
  },
  update: async (patch) => {
    const next = merge(get().settings, patch)
    set({ settings: next })
    await lh.settingsSet(patch as Record<string, unknown>)
  }
}))
