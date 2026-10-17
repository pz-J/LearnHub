import { useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventContentArg, EventClickArg } from '@fullcalendar/core'
import type { DateClickArg } from '@fullcalendar/interaction'
import { useTodos } from '@/stores/todos'
import { useSchedule } from '@/stores/schedule'
import { useModuleEvents } from '@/stores/misc'
import { useUi } from '@/stores/ui'
import type { Todo } from '@/types'
import { toDateStr, today, weekOf, parseWeeks } from '@/lib/utils'
import { TodoEditor } from './TodoEditor'

const PRIORITY_COLOR: Record<string, string> = { high: '#ef5b7b', mid: '#f5a623', low: '#37c99e' }

export function CalendarModule() {
  const todos = useTodos((s) => s.items)
  const toggle = useTodos((s) => s.toggle)
  const schedule = useSchedule((s) => s.schedule)
  const moduleEvents = useModuleEvents((s) => s.items)
  const navigate = useUi((s) => s.navigate)
  const [editing, setEditing] = useState<Todo | 'new' | null>(null)
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)
  const calendarRef = useRef<FullCalendar>(null)

  const events = useMemo(() => {
    const list: { id: string; title: string; start: string; end?: string; allDay?: boolean; backgroundColor: string; extendedProps: Record<string, unknown> }[] = []

    // 待办
    for (const t of todos) {
      list.push({
        id: 'todo:' + t.id,
        title: (t.done ? '✓ ' : '') + t.title,
        start: t.time ? `${t.date}T${t.time}` : t.date,
        allDay: !t.time,
        backgroundColor: t.done ? '#3a4361' : PRIORITY_COLOR[t.priority] ?? '#5b8cff',
        extendedProps: { kind: 'todo', done: t.done }
      })
    }

    // 课程（按可见范围展开）
    if (range && schedule.semesterStart) {
      const cur = new Date(range.start)
      const end = new Date(range.end)
      while (cur < end) {
        const date = toDateStr(cur)
        const week = weekOf(schedule.semesterStart, date)
        const jsDay = cur.getDay() === 0 ? 7 : cur.getDay()
        for (const c of schedule.courses) {
          if (c.day !== jsDay) continue
          const weeks = parseWeeks(c.weeksText)
          if (!weeks[week - 1]) continue
          const p1 = schedule.periods.find((p) => p.n === c.startPeriod)
          const p2 = schedule.periods.find((p) => p.n === c.endPeriod)
          list.push({
            id: 'course:' + c.id + ':' + date,
            title: `${c.name}${c.room ? ' @' + c.room : ''}`,
            start: p1 ? `${date}T${p1.start}` : date,
            end: p2 ? `${date}T${p2.end}` : undefined,
            allDay: !p1,
            backgroundColor: c.color,
            extendedProps: { kind: 'course' }
          })
        }
        cur.setDate(cur.getDate() + 1)
      }
    }

    // 模块事件
    for (const e of moduleEvents) {
      list.push({
        id: 'me:' + e.id,
        title: e.title,
        start: e.time ? `${e.date}T${e.time}` : e.date,
        allDay: !e.time,
        backgroundColor: e.color ?? '#9d6bff',
        extendedProps: { kind: 'module' }
      })
    }
    return list
  }, [todos, schedule, moduleEvents, range])

  const todayTodos = todos.filter((t) => t.date === today()).sort((a, b) => (a.time ?? '99') .localeCompare(b.time ?? '99'))

  const onEventClick = (arg: EventClickArg) => {
    const kind = arg.event.extendedProps.kind
    if (kind === 'todo') {
      const t = todos.find((x) => x.id === arg.event.id.slice(5))
      if (t) setEditing(t)
    } else if (kind === 'course') {
      navigate('library')
    }
  }

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      {/* 左侧：今日待办 */}
      <div className="flex w-64 shrink-0 flex-col rounded-xl border border-line bg-bg-card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">今日待办</span>
          <button
            className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:opacity-90"
            onClick={() => setEditing('new')}
          >
            + 添加
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {todayTodos.length === 0 && <div className="text-xs text-txt-dim">今天没有待办，点右上角添加一个吧</div>}
          {todayTodos.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-bg-soft p-2.5 hover:bg-bg-hover"
            >
              <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} className="mt-0.5 accent-accent" />
              <div className="min-w-0 flex-1" onClick={() => setEditing(t)}>
                <div className={`truncate text-sm ${t.done ? 'text-txt-dim line-through' : ''}`}>{t.title}</div>
                <div className="mt-0.5 text-xs text-txt-dim">
                  {t.time ?? '全天'} · {t.priority === 'high' ? '高优先' : t.priority === 'mid' ? '中' : '低'}
                  {t.repeat !== 'none' ? ` · ${t.repeat === 'daily' ? '每日' : '每周'}` : ''}
                </div>
              </div>
            </label>
          ))}
          <button
            className="w-full rounded-lg border border-line py-2 text-xs text-txt-dim hover:bg-bg-hover"
            onClick={() => navigate('mod:core.schedule:schedule')}
          >
            课表管理 →
          </button>
        </div>
      </div>

      {/* 右侧：日历 */}
      <div className="flex-1 overflow-hidden rounded-xl border border-line bg-bg-card p-3">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale="zh-cn"
          height="100%"
          firstDay={1}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          datesSet={(arg) => setRange({ start: arg.start, end: arg.end })}
          eventClick={onEventClick}
          dateClick={(arg: DateClickArg) => setEditing('new')}
          eventContent={(arg: EventContentArg) => (
            <div className="truncate px-1 text-[11px] leading-4" title={arg.event.title}>
              {arg.event.title}
            </div>
          )}
          dayMaxEventRows={4}
        />
      </div>

      {editing && <TodoEditor todo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
