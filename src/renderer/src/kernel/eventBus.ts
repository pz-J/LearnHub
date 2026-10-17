/** 宿主事件总线：内置模块直接订阅；沙箱模块由 loader 转发白名单事件 */
type Handler = (payload: unknown) => void

const handlers = new Map<string, Set<Handler>>()

export const eventBus = {
  on(name: string, h: Handler): () => void {
    if (!handlers.has(name)) handlers.set(name, new Set())
    handlers.get(name)!.add(h)
    return () => eventBus.off(name, h)
  },
  off(name: string, h: Handler): void {
    handlers.get(name)?.delete(h)
  },
  emit(name: string, payload?: unknown): void {
    handlers.get(name)?.forEach((h) => {
      try {
        h(payload)
      } catch (e) {
        console.error('[bus]', name, e)
      }
    })
    // 通配订阅（内核内部使用）
    handlers.get('*')?.forEach((h) => h({ name, payload }))
  }
}

/** 核心事件名 */
export const EVENTS = {
  selectionChanged: 'reader:selection-changed',
  highlightAdded: 'reader:highlight-added',
  highlightRemoved: 'reader:highlight-removed',
  scrollToHighlight: 'reader:scroll-to-highlight',
  paperOpened: 'reader:paper-opened',
  todoUpdated: 'data:todo-updated',
  scheduleUpdated: 'data:schedule-updated',
  notesUpdated: 'data:notes-updated',
  flashcardsUpdated: 'data:flashcards-updated',
  syncDone: 'sync:done',
  focusDone: 'focus:done',
  readerToolbarClick: 'reader:toolbar-click',
  markAnswerText: 'paper:mark-answer-text',
  libraryAction: 'library:action',
  aiChunk: 'ai:chunk',
  sidebarPanelRequested: 'sidebar:panel-requested'
}
