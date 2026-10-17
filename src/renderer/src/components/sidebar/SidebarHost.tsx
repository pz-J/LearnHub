import { lazy, Suspense, useEffect, useMemo } from 'react'
import { useUi } from '@/stores/ui'
import { modulePanels, useRegistry } from '@/kernel/registry'
import { BUILTIN_PANEL_COMPONENTS } from '@/components/builtin-modules'
import { AiPanel } from './AiPanel'
import { NotesPanel } from './NotesPanel'
import { PaperNoteBody } from './PaperNoteBody'
import { ModuleSandboxFrame } from '@/kernel/ModuleSandboxFrame'
import { cn } from '@/lib/utils'

const SearchPanel = lazy(() => import('./SearchPanel').then((m) => ({ default: m.SearchPanel })))

const CORE_TABS = [
  { id: 'ai', title: 'AI' },
  { id: 'search', title: '搜索链路' },
  { id: 'notes', title: '笔记' }
]

/**
 * 右侧侧边栏容器。
 * - stage 2（搜索展开为主界面）：侧边栏变为「上导图 + 下标记解释」的论文笔记视图
 * - stage 1（第一层搜索）：向左展开为宽侧栏
 * - stage 0：普通宽度
 */
export function SidebarHost() {
  const open = useUi((s) => s.sidebarOpen)
  const tab = useUi((s) => s.sidebarTab)
  const setTab = useUi((s) => s.setSidebarTab)
  const toggle = useUi((s) => s.toggleSidebar)
  const stage = useUi((s) => s.searchStage)
  const activePaperId = useUi((s) => s.activePaperId)
  const modules = useRegistry((s) => s.modules)
  const panels = useMemo(() => modulePanels(), [modules])
  const tabs = useMemo(() => [...CORE_TABS, ...panels.map((p) => ({ id: p.id, title: p.title }))], [panels])

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab('ai')
  }, [tabs, tab, setTab])

  const width = stage === 1 ? 'w-[56vw]' : 'w-[min(420px,38vw)]'

  // 搜索主界面模式：侧边栏 = 论文笔记（导图 + 问答 + 标记解释）
  if (stage === 2) {
    return (
      <div className={cn('flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-bg', width)}>
        <PaperNoteBody paperId={activePaperId} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden bg-bg transition-[width] duration-200',
        open ? `${width} border-l border-line` : 'w-0 border-l-0'
      )}
    >
        {open && (
          <>
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-1.5 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={cn(
              'shrink-0 rounded-lg px-2.5 py-1 text-xs',
              tab === t.id ? 'bg-accent text-white' : 'text-txt-dim hover:bg-bg-hover hover:text-txt'
            )}
            onClick={() => setTab(t.id)}
          >
            {t.title}
          </button>
        ))}
        <button className={cn('shrink-0 rounded-lg px-2 py-1 text-xs text-txt-dim hover:bg-bg-hover', !activePaperId && 'ml-auto')} onClick={() => toggle(false)} title="收起">
          »
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'ai' && <AiPanel />}
        {tab === 'search' && <Suspense fallback={<div className="p-4 text-sm text-txt-dim">正在加载搜索链路…</div>}><SearchPanel /></Suspense>}
        {/* 笔记：有打开的论文 → 本文笔记（导图+问答+标记解释，可编辑）；否则 → 常规笔记列表 */}
        {tab === 'notes' && (activePaperId ? <PaperNoteBody paperId={activePaperId} /> : <NotesPanel />)}
        {panels
          .filter((p) => tab === p.id)
          .map((p) => {
            const Builtin = BUILTIN_PANEL_COMPONENTS[p.id]
            if (Builtin) return <Suspense key={p.id} fallback={<div className="p-4 text-sm text-txt-dim">正在加载模块…</div>}><Builtin /></Suspense>
            return <ModuleSandboxFrame key={p.id} moduleId={p.moduleId} />
          })}
      </div>
          </>
        )}
    </div>
  )
}
