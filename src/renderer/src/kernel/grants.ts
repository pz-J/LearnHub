import { create } from 'zustand'
import { lh } from '@/lib/ipc'
import { isCapability, type Capability } from './permissions'

/** 授权记录：userData/module-grants.json（不同步） */
interface GrantsState {
  grants: Record<string, Capability[]>
  loaded: boolean
  load: () => Promise<void>
  grant: (moduleId: string, cap: Capability) => Promise<void>
  revoke: (moduleId: string, cap: Capability) => Promise<void>
  revokeAll: (moduleId: string) => Promise<void>
  has: (moduleId: string, cap: Capability) => boolean
}

async function persist(grants: Record<string, Capability[]>): Promise<void> {
  await lh.grantsSet(grants)
}

export const useGrants = create<GrantsState>((set, get) => ({
  grants: {},
  loaded: false,
  load: async () => {
    const raw = (await lh.grantsGet()) as Record<string, unknown> | null
    const clean: Record<string, Capability[]> = {}
    let changed = false
    for (const [moduleId, caps] of Object.entries(raw ?? {})) {
      const valid = Array.isArray(caps) ? caps.filter((cap): cap is Capability => typeof cap === 'string' && isCapability(cap)) : []
      if (!Array.isArray(caps) || valid.length !== caps.length) changed = true
      if (valid.length) clean[moduleId] = valid
    }
    set({ grants: clean, loaded: true })
    // 清理旧版本留下的未实现权限名，避免它们继续出现在授权详情中。
    if (changed) {
      try { await persist(clean) } catch { /* 读取仍可继续；下次授权写入会重试持久化 */ }
    }
  },
  grant: async (moduleId, cap) => {
    const cur = get().grants[moduleId] ?? []
    if (cur.includes(cap)) return
    const next = { ...get().grants, [moduleId]: [...cur, cap] }
    set({ grants: next })
    await persist(next)
  },
  revoke: async (moduleId, cap) => {
    const next = { ...get().grants, [moduleId]: (get().grants[moduleId] ?? []).filter((c) => c !== cap) }
    set({ grants: next })
    await persist(next)
  },
  revokeAll: async (moduleId) => {
    const next = { ...get().grants }
    delete next[moduleId]
    set({ grants: next })
    await persist(next)
  },
  has: (moduleId, cap) => (get().grants[moduleId] ?? []).includes(cap)
}))
