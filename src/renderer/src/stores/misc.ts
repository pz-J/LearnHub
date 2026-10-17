import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { eventBus } from '@/kernel/eventBus'
import type { FocusSession, ModuleCalEvent } from '@/types'

const FOCUS_FILE = 'focus-log.json'
const EVENTS_FILE = 'module-events.json'

interface FocusState {
  sessions: FocusSession[]
  loaded: boolean
  load: () => Promise<void>
  add: (s: { minutes: number; label?: string; paperId?: string; start?: number; end?: number }) => Promise<void>
}

export const useFocus = create<FocusState>((set, get) => ({
  sessions: [],
  loaded: false,
  load: async () => {
    const data = (await lh.dataRead(FOCUS_FILE)) as { items?: FocusSession[] } | null
    set({ sessions: data?.items ?? [], loaded: true })
  },
  add: async (s) => {
    const now = Date.now()
    const session: FocusSession = {
      id: uid('fo_'),
      start: s.start ?? now - s.minutes * 60000,
      end: s.end ?? now,
      minutes: s.minutes,
      label: s.label,
      paperId: s.paperId
    }
    set({ sessions: [...get().sessions, session] })
    await lh.dataWrite(FOCUS_FILE, { items: get().sessions, updatedAt: now })
    eventBus.emit('focus:done', session)
  }
}))

interface ModuleEventsState {
  items: ModuleCalEvent[]
  loaded: boolean
  load: () => Promise<void>
  addFor: (moduleId: string, evs: Omit<ModuleCalEvent, 'id' | 'moduleId' | 'createdAt'>[]) => Promise<void>
  removeFor: (moduleId: string, filter?: { date?: string; id?: string }) => Promise<void>
}

export const useModuleEvents = create<ModuleEventsState>((set, get) => ({
  items: [],
  loaded: false,
  load: async () => {
    const data = (await lh.dataRead(EVENTS_FILE)) as { items?: ModuleCalEvent[] } | null
    set({ items: data?.items ?? [], loaded: true })
  },
  addFor: async (moduleId, evs) => {
    const now = Date.now()
    const items = [
      ...get().items,
      ...evs.map((e) => ({ ...e, id: uid('me_'), moduleId, createdAt: now }))
    ]
    set({ items })
    await lh.dataWrite(EVENTS_FILE, { items, updatedAt: now })
  },
  removeFor: async (moduleId, filter) => {
    const items = get().items.filter((e) => {
      if (e.moduleId !== moduleId) return true
      if (filter?.id) return e.id !== filter.id
      if (filter?.date) return e.date !== filter.date
      return false
    })
    set({ items })
    await lh.dataWrite(EVENTS_FILE, { items, updatedAt: Date.now() })
  }
}))
