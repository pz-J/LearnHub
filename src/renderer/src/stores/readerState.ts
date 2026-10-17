import { create } from 'zustand'

export interface ReaderSelection {
  text: string
  page: number
  rects: { x: number; y: number; w: number; h: number }[]
  highlightId?: string
}

interface ToolbarButton {
  id: string
  moduleId: string
  title: string
}

interface ReaderState {
  selection: ReaderSelection | null
  toolbarButtons: ToolbarButton[]
  hoverHighlightId: string | null
  flashHighlightId: string | null
  setSelection: (s: ReaderSelection | null) => void
  registerButton: (moduleId: string, b: { id: string; title: string }) => void
  unregisterModule: (moduleId: string) => void
  setHover: (id: string | null) => void
  flash: (id: string | null) => void
}

export const useReaderState = create<ReaderState>((set) => ({
  selection: null,
  toolbarButtons: [],
  hoverHighlightId: null,
  flashHighlightId: null,
  setSelection: (s) => set({ selection: s }),
  registerButton: (moduleId, b) =>
    set((st) => ({
      toolbarButtons: [...st.toolbarButtons.filter((x) => !(x.moduleId === moduleId && x.id === b.id)), { id: b.id, moduleId, title: b.title }]
    })),
  unregisterModule: (moduleId) =>
    set((st) => ({ toolbarButtons: st.toolbarButtons.filter((b) => b.moduleId !== moduleId) })),
  setHover: (id) => set({ hoverHighlightId: id }),
  flash: (id) => {
    set({ flashHighlightId: id })
    if (id) setTimeout(() => set({ flashHighlightId: null }), 1800)
  }
}))
