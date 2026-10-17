import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { eventBus } from '@/kernel/eventBus'
import type { Flashcard } from '@/types'
import { today } from '@/lib/utils'

const FILE = 'flashcards.json'

/** SM-2 算法：quality 0-5 */
export function sm2(card: Flashcard, quality: number): Partial<Flashcard> {
  let { ef, interval, reps } = card
  if (quality < 3) {
    reps = 0
    interval = 1
  } else {
    if (reps === 0) interval = 1
    else if (reps === 1) interval = 6
    else interval = Math.round(interval * ef)
    reps += 1
  }
  ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  if (ef < 1.3) ef = 1.3
  const due = new Date(Date.now() + interval * 86400000)
  const y = due.getFullYear()
  const m = String(due.getMonth() + 1).padStart(2, '0')
  const d = String(due.getDate()).padStart(2, '0')
  return { ef, interval, reps, due: `${y}-${m}-${d}`, lastReview: Date.now() }
}

interface FlashcardsState {
  items: Flashcard[]
  loaded: boolean
  load: () => Promise<void>
  add: (c: Partial<Flashcard>) => Promise<Flashcard>
  update: (id: string, patch: Partial<Flashcard>) => Promise<void>
  review: (id: string, quality: number) => Promise<void>
  remove: (id: string) => Promise<void>
  dueToday: () => Flashcard[]
}

async function persist(items: Flashcard[]): Promise<void> {
  await lh.dataWrite(FILE, { items, updatedAt: Date.now() })
}

export const useFlashcards = create<FlashcardsState>((set, get) => ({
  items: [],
  loaded: false,
  load: async () => {
    const data = (await lh.dataRead(FILE)) as { items?: Flashcard[] } | null
    set({ items: data?.items ?? [], loaded: true })
  },
  add: async (c) => {
    const now = Date.now()
    const card: Flashcard = {
      id: uid('f_'),
      q: c.q ?? '',
      a: c.a ?? '',
      source: c.source,
      ef: 2.5,
      interval: 0,
      reps: 0,
      due: c.due ?? today(),
      createdAt: now,
      updatedAt: now
    }
    set({ items: [...get().items, card] })
    await persist(get().items)
    eventBus.emit('data:flashcards-updated')
    return card
  },
  update: async (id, patch) => {
    set({ items: get().items.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)) })
    await persist(get().items)
  },
  review: async (id, quality) => {
    const card = get().items.find((c) => c.id === id)
    if (!card) return
    await get().update(id, sm2(card, quality))
  },
  remove: async (id) => {
    set({ items: get().items.filter((c) => c.id !== id) })
    await persist(get().items)
    eventBus.emit('data:flashcards-updated')
  },
  dueToday: () => {
    const t = today()
    return get().items.filter((c) => c.due <= t)
  }
}))
