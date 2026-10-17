import { useMemo } from 'react'
import { useFocus } from '@/stores/misc'
import { useTodos } from '@/stores/todos'
import { useFlashcards } from '@/stores/flashcards'
import { usePapers } from '@/stores/papers'
import { useModuleEvents } from '@/stores/misc'
import { toDateStr, today } from '@/lib/utils'

/** 内置子模块：学习统计（专注/待办/闪卡/文献概览） */
export function StatsModule() {
  const focus = useFocus((s) => s.sessions)
  const todos = useTodos((s) => s.items)
  const cards = useFlashcards((s) => s.items)
  const papers = usePapers((s) => s.papers)
  const moduleEvents = useModuleEvents((s) => s.items)

  const days = useMemo(() => {
    const out: { date: string; label: string; minutes: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      const date = toDateStr(d)
      const minutes = focus.filter((f) => toDateStr(new Date(f.start)) === date).reduce((a, f) => a + f.minutes, 0)
      out.push({ date, label: i === 0 ? '今' : `${d.getMonth() + 1}/${d.getDate()}`, minutes })
    }
    return out
  }, [focus])

  const maxMin = Math.max(60, ...days.map((d) => d.minutes))
  const totalFocus = focus.reduce((a, f) => a + f.minutes, 0)
  const doneTodos = todos.filter((t) => t.done).length
  const todayDone = todos.filter((t) => t.done && toDateStr(new Date(t.updatedAt)) === today()).length
  const highlightCount = Object.values(papers).reduce((a, p) => a + p.highlights.length, 0)
  const dueCount = cards.filter((c) => c.due <= today()).length

  const cards2 = [
    { label: '累计专注', value: `${Math.round(totalFocus)} 分钟`, sub: `共 ${focus.length} 次番茄` },
    { label: '待办完成', value: `${doneTodos} / ${todos.length}`, sub: `今日完成 ${todayDone}` },
    { label: '闪卡', value: `${cards.length} 张`, sub: `今日待复习 ${dueCount}` },
    { label: '文献', value: `${Object.keys(papers).length} 篇`, sub: `高亮 ${highlightCount} 处` },
    { label: '模块日程', value: `${moduleEvents.length} 条`, sub: '来自各功能模块' }
  ]

  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="mb-4 text-lg font-semibold">学习统计</h1>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards2.map((c) => (
          <div key={c.label} className="rounded-xl border border-line bg-bg-card p-4">
            <div className="text-xs text-txt-dim">{c.label}</div>
            <div className="mt-1 text-xl font-semibold">{c.value}</div>
            <div className="mt-1 text-xs text-txt-dim">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-bg-card p-4">
        <div className="mb-3 text-sm font-medium">近 7 日专注（分钟）</div>
        <div className="flex h-40 items-end gap-3">
          {days.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="text-xs text-txt-dim">{d.minutes || ''}</div>
              <div
                className="w-full rounded-t bg-accent/70 transition-all"
                style={{ height: `${Math.max(4, (d.minutes / maxMin) * 100)}%` }}
                title={`${d.date}：${d.minutes} 分钟`}
              />
              <div className="text-xs text-txt-dim">{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 text-xs text-txt-dim">专注数据来自番茄钟模块（focus-log），开启番茄钟并完成专注后此处可见曲线。</div>
    </div>
  )
}
