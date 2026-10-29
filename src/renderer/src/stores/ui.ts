import { create } from 'zustand'

export type Route =
  | 'home'
  | 'calendar'
  | 'library'
  | 'reader'
  | 'notes'
  | 'hub'
  | 'settings'
  | `mod:${string}`

interface ConsentRequest {
  key: string
  moduleId: string
  moduleName: string
  capability: string
  reason: string
  kind: 'runtime' | 'install'
  requestedBy?: string
  manifest?: unknown
  resolve?: (granted: boolean) => void
}

interface UiState {
  route: Route
  activePaperId: string | null
  sidebarOpen: boolean
  sidebarTab: string
  /** 搜索展示阶段：0 普通侧栏 / 1 侧栏向左展开（宽）/ 2 搜索页展开为主界面（覆盖论文） */
  searchStage: 0 | 1 | 2
  quickSearchOpen: boolean
  requestedNoteId: string | null
  requestedHighlight: { paperId: string; highlightId: string } | null
  requestedPage: { paperId: string; page: number } | null
  consentQueue: ConsentRequest[]
  toasts: { id: number; text: string; kind: 'info' | 'error' | 'ok'; onClick?: () => void }[]
  toast: (text: string, kind?: 'info' | 'error' | 'ok', onClick?: () => void) => void
  navigate: (r: Route) => void
  openPaper: (paperId: string) => void
  setSidebarTab: (t: string) => void
  toggleSidebar: (open?: boolean) => void
  setSearchStage: (n: 0 | 1 | 2) => void
  setQuickSearch: (open: boolean) => void
  openNote: (noteId: string) => void
  consumeRequestedNote: () => string | null
  openPaperAtHighlight: (paperId: string, highlightId: string) => void
  consumeRequestedHighlight: () => { paperId: string; highlightId: string } | null
  openPaperAtPage: (paperId: string, page: number) => void
  consumeRequestedPage: () => { paperId: string; page: number } | null
  pushConsent: (req: ConsentRequest) => void
  resolveConsent: (key: string, granted: boolean) => void
}

let toastId = 1

export const useUi = create<UiState>((set, get) => ({
  route: 'home',
  activePaperId: null,
  sidebarOpen: false,
  sidebarTab: 'ai',
  searchStage: 0,
  quickSearchOpen: false,
  requestedNoteId: null,
  requestedHighlight: null,
  requestedPage: null,
  consentQueue: [],
  toasts: [],
  toast: (text, kind = 'info', onClick) => {
    const id = toastId++
    set({ toasts: [...get().toasts, { id, text, kind, onClick }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
  navigate: (r) => set({ route: r, searchStage: 0 }),
  openPaper: (paperId) => set({ route: 'reader', activePaperId: paperId, sidebarOpen: true, searchStage: 0, requestedHighlight: null, requestedPage: null }),
  setSidebarTab: (t) => set({ sidebarTab: t }),
  toggleSidebar: (open) => set({ sidebarOpen: open ?? !get().sidebarOpen }),
  setSearchStage: (n) => set({ searchStage: n }),
  setQuickSearch: (open) => set({ quickSearchOpen: open }),
  openNote: (noteId) => set({ route: 'notes', searchStage: 0, requestedNoteId: noteId }),
  consumeRequestedNote: () => {
    const id = get().requestedNoteId
    if (id) set({ requestedNoteId: null })
    return id
  },
  openPaperAtHighlight: (paperId, highlightId) => set({ route: 'reader', activePaperId: paperId, sidebarOpen: true, searchStage: 0, requestedHighlight: { paperId, highlightId }, requestedPage: null }),
  consumeRequestedHighlight: () => {
    const requested = get().requestedHighlight
    if (requested) set({ requestedHighlight: null })
    return requested
  },
  openPaperAtPage: (paperId, page) => set({ route: 'reader', activePaperId: paperId, sidebarOpen: true, searchStage: 0, requestedHighlight: null, requestedPage: { paperId, page } }),
  consumeRequestedPage: () => {
    const requested = get().requestedPage
    if (requested) set({ requestedPage: null })
    return requested
  },
  pushConsent: (req) => set({ consentQueue: [...get().consentQueue, req] }),
  resolveConsent: (key, granted) => {
    const q = get().consentQueue
    const item = q.find((r) => r.key === key)
    set({ consentQueue: q.filter((r) => r.key !== key) })
    item?.resolve?.(granted)
  }
}))
