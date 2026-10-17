import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import type { Mindmap, MindNode } from '@/types'

const DIR = 'mindmaps'

interface MindmapsState {
  maps: Record<string, Mindmap>
  loaded: boolean
  load: () => Promise<void>
  create: (title: string, paperId?: string, rootLabel?: string, originText?: string) => Promise<Mindmap>
  save: (id: string, patch: Partial<Mindmap>) => Promise<void>
  remove: (id: string) => Promise<void>
  addNode: (mapId: string, node: Omit<MindNode, 'id' | 'createdAt'>) => MindNode | null
  updateNode: (mapId: string, nodeId: string, patch: Partial<MindNode>) => void
  removeNode: (mapId: string, nodeId: string) => string[]
  get: (id: string) => Mindmap | undefined
}

async function persist(m: Mindmap): Promise<void> {
  m.updatedAt = Date.now()
  await lh.dataWrite(`${DIR}/${m.id}.json`, m)
}

export const useMindmaps = create<MindmapsState>((set, get) => ({
  maps: {},
  loaded: false,
  load: async () => {
    const files = await lh.dataList(DIR)
    const maps: Record<string, Mindmap> = {}
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const m = (await lh.dataRead(`${DIR}/${f}`)) as Mindmap | null
      if (m?.id) maps[m.id] = m
    }
    set({ maps, loaded: true })
  },
  create: async (title, paperId, rootLabel, originText) => {
    const now = Date.now()
    const root: MindNode = {
      id: uid('mn_'),
      label: rootLabel ?? title,
      level: 1,
      parentId: null,
      originText,
      status: 'pending',
      createdAt: now
    }
    const map: Mindmap = { id: uid('mm_'), title, paperId, nodes: [root], createdAt: now, updatedAt: now }
    set({ maps: { ...get().maps, [map.id]: map } })
    await persist(map)
    return map
  },
  save: async (id, patch) => {
    const m = get().maps[id]
    if (!m) return
    const next = { ...m, ...patch, updatedAt: Date.now() }
    set({ maps: { ...get().maps, [id]: next } })
    await persist(next)
  },
  remove: async (id) => {
    await lh.dataDelete(`${DIR}/${id}.json`)
    const maps = { ...get().maps }
    delete maps[id]
    set({ maps })
  },
  addNode: (mapId, node) => {
    const m = get().maps[mapId]
    if (!m) return null
    const n: MindNode = { ...node, id: uid('mn_'), createdAt: Date.now() }
    const next = { ...m, nodes: [...m.nodes, n], updatedAt: Date.now() }
    set({ maps: { ...get().maps, [mapId]: next } })
    void persist(next)
    return n
  },
  updateNode: (mapId, nodeId, patch) => {
    const m = get().maps[mapId]
    if (!m) return
    const next = {
      ...m,
      nodes: m.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
      updatedAt: Date.now()
    }
    set({ maps: { ...get().maps, [mapId]: next } })
    void persist(next)
  },
  removeNode: (mapId, nodeId) => {
    const m = get().maps[mapId]
    if (!m) return []
    const doomed = new Set([nodeId])
    let changed = true
    while (changed) {
      changed = false
      for (const n of m.nodes) {
        if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
          doomed.add(n.id)
          changed = true
        }
      }
    }
    const next = { ...m, nodes: m.nodes.filter((n) => !doomed.has(n.id)), updatedAt: Date.now() }
    set({ maps: { ...get().maps, [mapId]: next } })
    void persist(next)
    return [...doomed]
  },
  get: (id) => get().maps[id]
}))
