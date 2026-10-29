import { useEffect, useState } from 'react'
import { useUi } from '@/stores/ui'
import { usePapers } from '@/stores/papers'
import { useTodos } from '@/stores/todos'
import { useNotes } from '@/stores/notes'
import { truncate } from '@/lib/utils'
import type { Route } from '@/stores/ui'
import { searchResearch, type ResearchSearchResult } from '@/lib/researchSearch'
import { createTodoWithFeedback } from '@/lib/todoCreation'

const NAV: { route: Route; title: string }[] = [
  { route: 'home', title: '学习首页' },
  { route: 'calendar', title: '日历' },
  { route: 'library', title: '文献库' },
  { route: 'reader', title: '阅读器' },
  { route: 'notes', title: '笔记' },
  { route: 'hub', title: '模块中心' },
  { route: 'settings', title: '设置' }
]

/** 全局快捷搜索（Ctrl+K）：论文 / 页面 / 快捷新建待办 */
export function QuickSearch() {
  const open = useUi((s) => s.quickSearchOpen)
  const setOpen = useUi((s) => s.setQuickSearch)
  const openPaper = useUi((s) => s.openPaper)
  const openPaperAtHighlight = useUi((s) => s.openPaperAtHighlight)
  const navigate = useUi((s) => s.navigate)
  const openNote = useUi((s) => s.openNote)
  const setSidebarTab = useUi((s) => s.setSidebarTab)
  const papers = usePapers((s) => s.papers)
  const order = usePapers((s) => s.order)
  const notes = useNotes((s) => s.notes)
  const addTodo = useTodos((s) => s.add)
  const toast = useUi((s) => s.toast)
  const [q, setQ] = useState('')
  const [creatingTodo, setCreatingTodo] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useUi.getState().quickSearchOpen)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) setQ('')
  }, [open])

  if (!open) return null

  const query = q.trim().toLowerCase()
  const paperList = order.map((id) => papers[id]).filter(Boolean)
  const results = searchResearch(q, paperList, Object.values(notes), 24)
  const navHits = NAV.filter((n) => query && n.title.includes(query))
  const showTodo = query.length > 0

  const close = () => setOpen(false)
  const createTodo = async () => {
    const title = q.trim()
    if (!title || creatingTodo) return
    setCreatingTodo(true)
    await createTodoWithFeedback({
      title,
      add: (value) => addTodo({ title: value }),
      onSuccess: () => {
        toast('已添加到今日待办', 'ok')
        close()
      },
      onError: (error) => toast(`待办保存失败：${(error as Error).message || '请重试'}`, 'error')
    })
    setCreatingTodo(false)
  }
  const openResult = (result: ResearchSearchResult) => {
    if (result.kind === 'note' && result.noteId) {
      openNote(result.noteId)
    } else if (result.paperId) {
      if (result.highlightId) {
        openPaperAtHighlight(result.paperId, result.highlightId)
      } else {
        openPaper(result.paperId)
        setSidebarTab('notes')
      }
    }
    close()
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 pt-28" onClick={close}>
      <div className="w-[560px] overflow-hidden rounded-xl border border-line bg-bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none"
          placeholder="搜索论文 / 页面，或输入文字直接建待办…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (results[0]) {
                openResult(results[0])
                close()
              } else if (navHits[0]) {
                navigate(navHits[0].route)
                close()
              } else if (query) {
                e.preventDefault()
                void createTodo()
              }
            }
          }}
        />
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length > 0 && <div className="px-2 py-1 text-xs text-txt-dim">研究资料 · {results.length} 条</div>}
          {results.map((result) => (
            <button
              key={result.id}
              className="block w-full rounded-lg px-2 py-2 text-left hover:bg-bg-hover"
              onClick={() => openResult(result)}
            >
              <span className="flex items-center gap-2"><span className="shrink-0 rounded bg-bg px-1.5 py-0.5 text-[10px] text-txt-dim">{{ paper: '论文', highlight: result.page ? `P${result.page}` : '标记', explanation: result.page ? `P${result.page} · AI` : 'AI 解释', answer: '问答', note: '笔记' }[result.kind]}</span><span className="min-w-0 flex-1 truncate text-sm">{truncate(result.title, 60)}</span></span>
              <span className="mt-1 block truncate pl-1 text-xs text-txt-dim">{truncate(result.context, 110)}</span>
            </button>
          ))}
          {navHits.length > 0 && <div className="px-2 py-1 text-xs text-txt-dim">页面</div>}
          {navHits.map((n) => (
            <button
              key={n.route}
              className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-bg-hover"
              onClick={() => {
                navigate(n.route)
                close()
              }}
            >
              → {n.title}
            </button>
          ))}
          {showTodo && (
            <>
              <div className="px-2 py-1 text-xs text-txt-dim">待办</div>
              <button
                className="block w-full rounded-lg px-2 py-2 text-left text-sm text-accent hover:bg-bg-hover"
                onClick={() => void createTodo()}
                disabled={creatingTodo}
              >
                {creatingTodo ? '正在保存…' : `+ 新建待办「${truncate(q, 20)}」（今天）`}
              </button>
            </>
          )}
          {query && results.length === 0 && navHits.length === 0 && <div className="px-3 py-6 text-center text-xs text-txt-dim">没有匹配的研究资料。试试论文中的术语、批注内容或笔记正文。</div>}
          {!query && results.length === 0 && <div className="py-6 text-center text-xs text-txt-dim">输入关键词搜索论文、标记、批注、已保存解释、问答和笔记；Enter 打开第一项。</div>}
        </div>
      </div>
    </div>
  )
}
