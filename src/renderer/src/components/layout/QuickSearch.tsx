import { useEffect, useState } from 'react'
import { useUi } from '@/stores/ui'
import { usePapers } from '@/stores/papers'
import { useTodos } from '@/stores/todos'
import { truncate } from '@/lib/utils'
import type { Route } from '@/stores/ui'

const NAV: { route: Route; title: string }[] = [
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
  const navigate = useUi((s) => s.navigate)
  const papers = usePapers((s) => s.papers)
  const order = usePapers((s) => s.order)
  const addTodo = useTodos((s) => s.add)
  const [q, setQ] = useState('')

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
  const paperHits = order
    .map((id) => papers[id])
    .filter((p) => p && (!query || p.title.toLowerCase().includes(query)))
    .slice(0, 6)
  const navHits = NAV.filter((n) => query && n.title.includes(query))
  const showTodo = query.length > 0

  const close = () => setOpen(false)

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
              if (paperHits[0]) {
                openPaper(paperHits[0].id)
                close()
              } else if (navHits[0]) {
                navigate(navHits[0].route)
                close()
              } else if (query) {
                void addTodo({ title: q.trim() })
                close()
              }
            }
          }}
        />
        <div className="max-h-80 overflow-y-auto p-2">
          {paperHits.length > 0 && <div className="px-2 py-1 text-xs text-txt-dim">论文</div>}
          {paperHits.map((p) => (
            <button
              key={p.id}
              className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-bg-hover"
              onClick={() => {
                openPaper(p.id)
                close()
              }}
            >
              {truncate(p.title, 46)}
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
                onClick={() => {
                  void addTodo({ title: q.trim() })
                  close()
                }}
              >
                + 新建待办「{truncate(q, 20)}」（今天）
              </button>
            </>
          )}
          {!query && paperHits.length === 0 && <div className="py-6 text-center text-xs text-txt-dim">输入关键词搜索，Enter 打开第一项</div>}
        </div>
      </div>
    </div>
  )
}
