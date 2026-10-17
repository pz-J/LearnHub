import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { eventBus } from '@/kernel/eventBus'
import type { Note } from '@/types'

const DIR = 'notes'

function parseMarkdown(id: string, raw: string): Note {
  let body = raw
  const note: Note = { id, title: id.replace(/\.md$/, ''), tags: [], updatedAt: 0, body: '' }
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (m) {
    body = raw.slice(m[0].length)
    const fm = m[1]
    const t = fm.match(/^title:\s*(.+)$/m)
    if (t) note.title = t[1].trim()
    const tg = fm.match(/^tags:\s*(.+)$/m)
    if (tg) note.tags = tg[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    const pid = fm.match(/^paperId:\s*(.+)$/m)
    if (pid) note.paperId = pid[1].trim()
    const up = fm.match(/^updatedAt:\s*(\d+)$/m)
    if (up) note.updatedAt = parseInt(up[1])
  }
  note.body = body
  return note
}

function toMarkdown(n: Note): string {
  const fm = [
    '---',
    `title: ${n.title}`,
    `tags: ${n.tags.join(',')}`,
    n.paperId ? `paperId: ${n.paperId}` : null,
    `updatedAt: ${Date.now()}`,
    '---',
    ''
  ]
    .filter((x) => x !== null)
    .join('\n')
  return fm + n.body
}

interface NotesState {
  notes: Record<string, Note>
  loaded: boolean
  load: () => Promise<void>
  write: (id: string | null, patch: Partial<Note>) => Promise<Note>
  remove: (id: string) => Promise<void>
  listFor: (paperId?: string) => Note[]
}

export const useNotes = create<NotesState>((set, get) => ({
  notes: {},
  loaded: false,
  load: async () => {
    const files = await lh.dataList(DIR)
    const notes: Record<string, Note> = {}
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const raw = (await lh.dataRead(`${DIR}/${f}`)) as string | null
      if (raw != null) notes[f] = parseMarkdown(f, raw)
    }
    set({ notes, loaded: true })
  },
  write: async (id, patch) => {
    const nid = id ?? uid('n_') + '.md'
    const cur = get().notes[nid]
    const next: Note = {
      id: nid,
      title: patch.title ?? cur?.title ?? nid.replace(/\.md$/, ''),
      tags: patch.tags ?? cur?.tags ?? [],
      paperId: patch.paperId ?? cur?.paperId,
      updatedAt: Date.now(),
      body: patch.body ?? cur?.body ?? ''
    }
    set({ notes: { ...get().notes, [nid]: next } })
    await lh.dataWrite(`${DIR}/${nid}`, toMarkdown(next))
    eventBus.emit('data:notes-updated')
    return next
  },
  remove: async (id) => {
    await lh.dataDelete(`${DIR}/${id}`)
    const notes = { ...get().notes }
    delete notes[id]
    set({ notes })
    eventBus.emit('data:notes-updated')
  },
  listFor: (paperId) =>
    Object.values(get().notes)
      .filter((n) => (paperId ? n.paperId === paperId : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
}))
