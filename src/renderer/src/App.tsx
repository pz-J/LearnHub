import { lazy, Suspense, useEffect } from 'react'
import { useUi } from '@/stores/ui'
import { NavBar } from './components/layout/NavBar'
import { QuickSearch } from './components/layout/QuickSearch'
import { SidebarHost } from '@/components/sidebar/SidebarHost'
const SearchPanel = lazy(() => import('@/components/sidebar/SearchPanel').then((m) => ({ default: m.SearchPanel })))
const CalendarModule = lazy(() => import('@/components/builtin-modules/calendar/CalendarModule').then((m) => ({ default: m.CalendarModule })))
const LibraryView = lazy(() => import('@/components/reader/LibraryView').then((m) => ({ default: m.LibraryView })))
const ReaderView = lazy(() => import('@/components/reader/ReaderView').then((m) => ({ default: m.ReaderView })))
const NotesView = lazy(() => import('@/components/views/NotesView').then((m) => ({ default: m.NotesView })))
const ModuleHub = lazy(() => import('@/components/hub/ModuleHub').then((m) => ({ default: m.ModuleHub })))
const SettingsView = lazy(() => import('@/components/settings/SettingsView').then((m) => ({ default: m.SettingsView })))
import { BUILTIN_ROUTE_COMPONENTS } from '@/components/builtin-modules'
import { AchievementToasts } from '@/components/builtin-modules/achievements/AchievementToasts'
import { ModuleSandboxFrame } from '@/kernel/ModuleSandboxFrame'
import { ConsentDialog } from '@/kernel/ConsentDialog'
import { eventBus, EVENTS } from '@/kernel/eventBus'
import { useSettings } from '@/stores/settings'
import { useRegistry } from '@/kernel/registry'

function ToastHost() {
  const toasts = useUi((s) => s.toasts)
  useEffect(() => {
    if (!toasts.length) return
    const t = setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.slice(1) })), 2600)
    return () => clearTimeout(t)
  }, [toasts])
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[95] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => {
        const cls = `rounded-lg border px-4 py-2 text-sm shadow-xl ${
          t.kind === 'error'
            ? 'border-red-500/40 bg-red-950/90 text-red-300'
            : t.kind === 'ok'
              ? 'border-green-500/40 bg-green-950/90 text-green-300'
              : 'border-line bg-bg-card text-txt'
        }`
        // 带 onClick 的 toast 渲染为可点击按钮（如成就达成提醒一键直达成就页）
        if (t.onClick) {
          return (
            <button
              key={t.id}
              type="button"
              className={`${cls} pointer-events-auto cursor-pointer text-left transition-transform hover:scale-[1.02]`}
              onClick={() => {
                useUi.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))
                t.onClick?.()
              }}
            >
              {t.text}
            </button>
          )
        }
        return (
          <div key={t.id} className={cls}>
            {t.text}
          </div>
        )
      })}
    </div>
  )
}

/** 外观主题同步：把 settings.appearance 落到 CSS 变量（模块经 ui.theme API 修改后同样生效） */
function ThemeSync() {
  const appearance = useSettings((s) => s.settings.appearance)
  useEffect(() => {
    const a = appearance ?? { accent: '#5b8cff', radius: 12, fontScale: 1 }
    const root = document.documentElement
    if (/^#[0-9a-fA-F]{6}$/.test(a.accent)) {
      const n = a.accent.slice(1)
      root.style.setProperty('--lh-accent-rgb', [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).join(' '))
    }
    root.style.setProperty('--lh-radius', `${a.radius}px`)
    root.style.setProperty('--lh-font-scale', String(a.fontScale))
  }, [appearance])
  return null
}

function RouteBody() {
  const route = useUi((s) => s.route)
  const navigate = useUi((s) => s.navigate)
  const moduleId = route.startsWith('mod:') ? route.slice(4).split(':')[0] : ''
  const moduleEnabled = useRegistry((s) => (moduleId ? s.modules[moduleId]?.enabled ?? false : true))
  if (route === 'calendar') return <Suspense fallback={<RouteLoading /> }><CalendarModule /></Suspense>
  if (route === 'library') return <Suspense fallback={<RouteLoading /> }><LibraryView /></Suspense>
  if (route === 'reader') return <Suspense fallback={<RouteLoading /> }><ReaderView /></Suspense>
  if (route === 'notes') return <Suspense fallback={<RouteLoading /> }><NotesView /></Suspense>
  if (route === 'hub') return <Suspense fallback={<RouteLoading /> }><ModuleHub /></Suspense>
  if (route === 'settings') return <Suspense fallback={<RouteLoading /> }><SettingsView /></Suspense>
  if (route.startsWith('mod:')) {
    if (!moduleEnabled) {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-line bg-bg-card p-6 text-center">
            <h2 className="text-base font-semibold">模块当前不可用</h2>
            <p className="mt-2 text-sm leading-6 text-txt-dim">该模块已停用或已卸载。你可以返回模块中心重新启用它。</p>
            <button className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90" onClick={() => navigate('hub')}>
              打开模块中心
            </button>
          </div>
        </div>
      )
    }
    const Builtin = BUILTIN_ROUTE_COMPONENTS[route]
    if (Builtin) return <Suspense fallback={<RouteLoading /> }><Builtin /></Suspense>
    const moduleId = route.slice(4).split(':')[0]
    return <ModuleSandboxFrame moduleId={moduleId} />
  }
  return null
}

function RouteLoading() {
  return <div className="flex h-full items-center justify-center text-sm text-txt-dim">正在加载…</div>
}

export function App() {
  const route = useUi((s) => s.route)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const stage = useUi((s) => s.searchStage)

  // 监听同步完成事件刷新标题等（占位：保持事件总线活跃）
  useEffect(() => eventBus.on(EVENTS.syncDone, () => {}), [])

  return (
    <div className="flex h-screen flex-col bg-bg text-txt">
      <ThemeSync />
      <NavBar />
      <div className="flex min-h-0 flex-1">
        {route === 'reader' && stage === 2 ? (
          <>
            {/* 搜索页展开为主界面，覆盖论文 */}
            <div className="min-w-0 flex-1 overflow-hidden">
            <Suspense fallback={<RouteLoading />}><SearchPanel variant="overlay" /></Suspense>
            </div>
            <SidebarHost />
          </>
        ) : (
          <>
            <main className="min-w-0 flex-1 overflow-hidden">
              <RouteBody />
            </main>
            {route === 'reader' && sidebarOpen && <SidebarHost />}
          </>
        )}
      </div>
      <ConsentDialog />
      <QuickSearch />
      <AchievementToasts />
      <ToastHost />
    </div>
  )
}
