import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { eventBus } from '@/kernel/eventBus'
import type { Todo } from '@/types'
import { today } from '@/lib/utils'
import { serializeByKey } from '@/lib/serialQueue'
import { persistThenPublish } from '@/lib/persistedWrite'

const FILE = 'todos.json'

interface TodosState {
  items: Todo[]
  loaded: boolean
  load: () => Promise<void>
  add: (t: Partial<Todo>) => Promise<Todo>
  update: (id: string, patch: Partial<Todo>) => Promise<void>
  toggle: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

async function persist(items: Todo[]): Promise<void> {
  await lh.dataWrite(FILE, { items, updatedAt: Date.now() })
}

export const useTodos = create<TodosState>((set, get) => ({
  items: [],
  loaded: false,
  load: async () => {
    const data = (await lh.dataRead(FILE)) as { items?: Todo[] } | null
    set({ items: data?.items ?? [], loaded: true })
  },
  add: async (t) => {
    return serializeByKey('todos', async () => {
      const current = get().items
      if (t.sourceKey) {
        const existing = current.find((item) => item.sourceKey === t.sourceKey)
        if (existing) return existing
      }
      const now = Date.now()
      const todo: Todo = {
        id: uid('t_'),
        title: t.title ?? '新待办',
        date: t.date ?? today(),
        time: t.time,
        priority: t.priority ?? 'mid',
        done: false,
        repeat: t.repeat ?? 'none',
        tags: t.tags ?? [],
        createdAt: now,
        updatedAt: now,
        sourceKey: t.sourceKey,
        sourceNoteId: t.sourceNoteId,
        sourcePaperId: t.sourcePaperId,
        sourcePage: t.sourcePage
      }
      const next = [...current, todo]
      await persistThenPublish(next, persist, (items) => set({ items }))
      eventBus.emit('data:todo-updated')
      return todo
    })
  },
  update: async (id, patch) => {
    await serializeByKey('todos', async () => {
      const current = get().items
      const next = current.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t))
      if (next.every((t, i) => t === current[i])) return
      await persistThenPublish(next, persist, (items) => set({ items }))
      eventBus.emit('data:todo-updated')
    })
  },
  toggle: async (id) => {
    await serializeByKey('todos', async () => {
      const current = get().items
      const target = current.find((x) => x.id === id)
      if (!target) return
      const next = current.map((t) => t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t)
      await persistThenPublish(next, persist, (items) => set({ items }))
      eventBus.emit('data:todo-updated')
    })
  },
  remove: async (id) => {
    await serializeByKey('todos', async () => {
      const current = get().items
      const next = current.filter((t) => t.id !== id)
      if (next.length === current.length) return
      await persistThenPublish(next, persist, (items) => set({ items }))
      eventBus.emit('data:todo-updated')
    })
  }
}))
