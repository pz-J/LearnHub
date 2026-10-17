import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { eventBus } from '@/kernel/eventBus'
import type { Todo } from '@/types'
import { today } from '@/lib/utils'

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
      updatedAt: now
    }
    set({ items: [...get().items, todo] })
    await persist(get().items)
    eventBus.emit('data:todo-updated')
    return todo
  },
  update: async (id, patch) => {
    set({ items: get().items.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) })
    await persist(get().items)
    eventBus.emit('data:todo-updated')
  },
  toggle: async (id) => {
    const t = get().items.find((x) => x.id === id)
    if (!t) return
    await get().update(id, { done: !t.done })
  },
  remove: async (id) => {
    set({ items: get().items.filter((t) => t.id !== id) })
    await persist(get().items)
    eventBus.emit('data:todo-updated')
  }
}))
