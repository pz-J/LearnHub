import { useMemo, useState } from 'react'
import { useUi, type Route } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { moduleRoutes, useRegistry } from '@/kernel/registry'
import { PomodoroWidget } from '@/components/builtin-modules/pomodoro/PomodoroModule'
import { syncNow } from '@/lib/sync'
import { cn } from '@/lib/utils'

const NAV: { route: Route; title: string }[] = [
  { route: 'calendar', title: '日历' },
  { route: 'library', title: '文献库' },
  { route: 'reader', title: '阅读器' },
  { route: 'notes', title: '笔记' },
  { route: 'hub', title: '模块中心' },
  { route: 'settings', title: '设置' }
]

export function NavBar() {
  const route = useUi((s) => s.route)
  const navigate = useUi((s) => s.navigate)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const toast = useUi((s) => s.toast)
  const setQuickSearch = useUi((s) => s.setQuickSearch)
  const settings = useSettings((s) => s.settings)
  const modules = useRegistry((s) => s.modules)
  const update = useSettings((s) => s.update)
  const [syncing, setSyncing] = useState(false)
  const [editing, setEditing] = useState(false)
  const modRoutes = useMemo(() => moduleRoutes(), [modules])

  // 菜单项 = 核心导航 + 模块路由；按 navOrder 排序，navHidden 隐藏
  const allItems = useMemo(
    () => [
      ...NAV.map((n) => ({ key: n.route, title: n.title })),
      ...modRoutes.map((r) => ({ key: r.key, title: r.title }))
    ],
    [modRoutes]
  )
  const ordered = useMemo(() => {
    const order = settings.navOrder ?? []
    const hidden = new Set(settings.navHidden ?? [])
    const byKey = new Map(allItems.map((i) => [i.key, i]))
    const out: typeof allItems = []
    for (const k of order) {
      const it = byKey.get(k)
      if (it) {
        out.push(it)
        byKey.delete(k)
      }
    }
    for (const it of allItems) if (byKey.has(it.key)) out.push(it)
    return out.filter((i) => !hidden.has(i.key))
  }, [allItems, settings.navOrder, settings.navHidden])

  const move = (key: string, dir: -1 | 1) => {
    const keys = ordered.map((i) => i.key)
    const idx = keys.indexOf(key)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= keys.length) return
    ;[keys[idx], keys[to]] = [keys[to], keys[idx]]
    void update({ navOrder: keys })
  }
  const toggleVisible = (key: string) => {
    const hidden = new Set(settings.navHidden ?? [])
    if (hidden.has(key)) hidden.delete(key)
    else hidden.add(key)
    void update({ navHidden: [...hidden] })
  }
  const resetNav = () => void update({ navOrder: [], navHidden: [] })

  const doSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const r = await syncNow()
      if (!r.ok) toast(r.error ?? '同步失败', 'error')
      else
        toast(
          `同步完成：推送 ${r.pushed} · 拉取 ${r.pulled}${r.conflicts ? ` · 冲突 ${r.conflicts}` : ''}${r.repoCreated ? '（已自动建仓）' : ''}`,
          'ok'
        )
    } catch (e) {
      toast(`同步失败：${(e as Error).message || '未知错误'}`, 'error')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="relative shrink-0 border-b border-line bg-bg-card">
      <div className="flex h-12 items-center gap-1 overflow-x-auto px-3">
        <div className="mr-3 flex shrink-0 items-center gap-1.5 font-semibold text-accent">
          <span className="text-lg">🎓</span> LearnHub
        </div>
        {ordered.map((n) => (
          <button
            key={n.key}
            className={cn(
              'shrink-0 rounded-lg px-2.5 py-1.5 text-sm',
              route === n.key ? 'bg-accent/15 font-medium text-accent' : 'text-txt-dim hover:bg-bg-hover hover:text-txt'
            )}
            onClick={() => navigate(n.key as Route)}
          >
            {n.title}
          </button>
        ))}

        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          <input
            readOnly
            className="w-40 cursor-pointer rounded-lg border border-line bg-bg px-3 py-1.5 text-xs text-txt-dim hover:border-accent/60"
            value="搜索 Ctrl + K"
            onClick={() => setQuickSearch(true)}
          />
          <PomodoroWidget />
          <button
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-bg-hover disabled:opacity-50"
            onClick={() => void doSync()}
            disabled={syncing}
            title="一键同步到 GitHub"
          >
            {syncing ? '同步中…' : '⟳ 同步'}
          </button>
          <button
            className={cn('rounded-lg border px-2 py-1.5 text-xs', editing ? 'border-accent text-accent' : 'border-line text-txt-dim hover:bg-bg-hover')}
            onClick={() => setEditing(!editing)}
            title="编辑菜单栏（排序 / 显隐）"
          >
            ☰
          </button>
          {route === 'reader' && (
            <button
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-bg-hover"
              onClick={() => toggleSidebar(!sidebarOpen)}
              title="侧边栏"
            >
              {sidebarOpen ? '»' : '«'}
            </button>
          )}
        </div>
      </div>

      {/* 菜单栏编辑面板：悬浮弹层，点击空白处关闭 */}
      {editing && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setEditing(false)} />
          <div className="absolute right-3 top-12 z-50 w-72 rounded-xl border border-line bg-bg-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">菜单栏编辑</span>
            <button className="rounded-md border border-line px-2 py-0.5 text-xs text-txt-dim hover:border-accent hover:text-accent" onClick={resetNav}>
              恢复默认
            </button>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {ordered.map((n) => (
              <div key={n.key} className="flex items-center gap-1 rounded-lg border border-line bg-bg px-2 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {n.title}
                </span>
                <button className="px-1 text-txt-dim hover:text-accent" onClick={() => move(n.key, -1)} title="上移">
                  ↑
                </button>
                <button className="px-1 text-txt-dim hover:text-accent" onClick={() => move(n.key, 1)} title="下移">
                  ↓
                </button>
                <button className="px-1 text-txt-dim hover:text-accent" onClick={() => toggleVisible(n.key)} title="隐藏">
                  👁
                </button>
              </div>
            ))}
            {(settings.navHidden ?? []).map((k) => (
              <div key={k} className="flex items-center gap-1 rounded-lg border border-dashed border-line px-2 py-1.5 text-xs text-txt-dim">
                <span className="min-w-0 flex-1 truncate">{allItems.find((i) => i.key === k)?.title ?? k}（已隐藏）</span>
                <button className="px-1 hover:text-accent" onClick={() => toggleVisible(k)}>
                  显示
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] leading-4 text-txt-dim">排序与显隐会自动保存；隐藏的项可随时在这里恢复。</div>
          </div>
        </>
      )}
    </div>
  )
}
