import { useState } from 'react'
import { useSchedule } from '@/stores/schedule'
import { useUi } from '@/stores/ui'
import { ImportScheduleDialog } from '../calendar/ImportScheduleDialog'
import type { Period } from '@/types'

const DAY_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 按开始时间把节次划入 上午 / 下午 / 晚上 */
function slotOf(p: Period): '上午' | '下午' | '晚上' {
  const h = Number(p.start.slice(0, 2))
  if (h < 12) return '上午'
  if (h < 18) return '下午'
  return '晚上'
}

/** 课表模块：学期起始、节次时长（含课间）自由调整、课程列表与 PDF 导入；与日历模块共享同一份 schedule 数据 */
export function ScheduleModuleView() {
  const schedule = useSchedule((s) => s.schedule)
  const setSemesterStart = useSchedule((s) => s.setSemesterStart)
  const setPeriods = useSchedule((s) => s.setPeriods)
  const removeCourse = useSchedule((s) => s.removeCourse)
  const toast = useUi((s) => s.toast)
  const [importing, setImporting] = useState(false)

  const slots: ('上午' | '下午' | '晚上')[] = ['上午', '下午', '晚上']
  const updatePeriod = (n: number, key: 'start' | 'end', value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value)) return
    void setPeriods(schedule.periods.map((p) => (p.n === n ? { ...p, [key]: value } : p)))
  }

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      {/* 左：学期与节次设置（每节起止时间即包含课间，自由调节） */}
      <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-bg-card">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold">课时设置</div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <label className="block text-xs text-txt-dim">
            学期第一周周一
            <input
              type="date"
              className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-sm text-txt"
              value={schedule.semesterStart}
              onChange={(e) => void setSemesterStart(e.target.value)}
            />
          </label>
          {slots.map((slot) => {
            const list = schedule.periods.filter((p) => slotOf(p) === slot)
            if (!list.length) return null
            return (
              <div key={slot}>
                <div className="mb-1 text-xs font-medium text-txt-dim">{slot}</div>
                <div className="space-y-1">
                  {list.map((p) => (
                    <div key={p.n} className="flex items-center gap-1.5 text-xs">
                      <span className="w-10 shrink-0 text-txt-dim">第{p.n}节</span>
                      <input
                        type="time"
                        className="min-w-0 flex-1 rounded border border-line bg-bg px-1.5 py-1"
                        value={p.start}
                        onChange={(e) => updatePeriod(p.n, 'start', e.target.value)}
                      />
                      <span className="text-txt-dim">~</span>
                      <input
                        type="time"
                        className="min-w-0 flex-1 rounded border border-line bg-bg px-1.5 py-1"
                        value={p.end}
                        onChange={(e) => updatePeriod(p.n, 'end', e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <div className="text-[11px] leading-4 text-txt-dim">调整每节的起止时间即可改变课间长短；日历模块按此时间同步显示课程。</div>
        </div>
      </div>

      {/* 右：课程列表 + 导入 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-bg-card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">课程（{schedule.courses.length}）</span>
          <button className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:opacity-90" onClick={() => setImporting(true)}>
            导入课表 PDF →
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {schedule.courses.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-txt-dim">还没有课程，点右上角导入课表 PDF</div>
          )}
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {schedule.courses.map((c) => (
              <div key={c.id} className="group relative rounded-lg border border-line bg-bg-soft p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                  <button
                    className="text-xs text-red-400 opacity-0 group-hover:opacity-100"
                    title="删除课程"
                    onClick={() => {
                      if (confirm(`删除课程「${c.name}」？`)) {
                        void removeCourse(c.id)
                        toast('已删除', 'ok')
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 text-xs text-txt-dim">
                  {DAY_LABEL[c.day]} 第{c.startPeriod}-{c.endPeriod}节
                  {c.room ? ` · ${c.room}` : ''}
                </div>
                <div className="mt-0.5 text-xs text-txt-dim">{c.weeksText || '每周'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {importing && <ImportScheduleDialog onClose={() => setImporting(false)} />}
    </div>
  )
}
