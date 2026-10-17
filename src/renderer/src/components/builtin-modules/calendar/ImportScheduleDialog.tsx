import { useState } from 'react'
import { lh } from '@/lib/ipc'
import { usePapers } from '@/stores/papers'
import { useSchedule, newCourse } from '@/stores/schedule'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { extractPdfItems, extractPdfPages } from '@/lib/pdf'
import { parseScheduleGrid, parseScheduleText } from '@/lib/scheduleParse'
import { aiAsk } from '@/lib/ai'
import type { Course } from '@/types'
import { COURSE_COLORS } from '@/types'

const DAY_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function ImportScheduleDialog({ onClose }: { onClose: () => void }) {
  const addCourses = useSchedule((s) => s.addCourses)
  const save = useSchedule((s) => s.save)
  const addPaper = usePapers((s) => s.add)
  const settings = useSettings((s) => s.settings)
  const toast = useUi((s) => s.toast)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [candidates, setCandidates] = useState<Course[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [semesterStart, setSemesterStart] = useState(settings.schedule.semesterStart)

  const parsePdf = async (paperId: string) => {
    // 启发式网格解析
    const pages = await extractPdfItems(paperId)
    let idx = 0
    const courses: Course[] = []
    for (const p of pages) {
      const found = parseScheduleGrid(p.items, () => idx++)
      courses.push(...found)
    }
    if (courses.length) return courses
    // 兜底：AI 解析
    const textPages = await extractPdfPages(paperId)
    const lines = parseScheduleText(textPages)
    return aiParse(lines.join('\n'), () => idx++)
  }

  const aiParse = async (text: string, nextColor: () => number): Promise<Course[]> => {
    if (!settings.ai.apiKey) throw new Error('自动解析失败，且未配置 AI（无法智能解析）。请尝试其他课表 PDF。')
    setBusy('AI 解析课表中…')
    const raw = await aiAsk(
      `以下是大学课表 PDF 提取的文本行。请解析出所有课程，输出 JSON 数组（不要输出其他内容）：` +
        `[{"name":"课程名","teacher":"教师可空","room":"教室可空","day":1到7表示周一到周日,"startPeriod":起始节次数字,"endPeriod":结束节次数字,"weeksText":"如1-16周，不确定则空"}]\n\n` +
        text.slice(0, 6000)
    )
    const m = raw.match(/\[[\s\S]*\]/)
    if (!m) throw new Error('AI 未能解析出课表')
    const arr = JSON.parse(m[0]) as Record<string, unknown>[]
    return arr.map((a) =>
      newCourse({
        name: String(a.name ?? '课程'),
        teacher: a.teacher ? String(a.teacher) : undefined,
        room: a.room ? String(a.room) : undefined,
        day: Math.min(7, Math.max(1, Number(a.day) || 1)),
        startPeriod: Math.max(1, Number(a.startPeriod) || 1),
        endPeriod: Math.max(1, Number(a.endPeriod) || 1),
        weeksText: a.weeksText ? String(a.weeksText) : undefined,
        color: COURSE_COLORS[nextColor() % COURSE_COLORS.length]
      })
    )
  }

  const pickAndParse = async () => {
    setError('')
    setBusy('读取 PDF…')
    try {
      const picked = await lh.pdfPickImport()
      if (!picked) {
        setBusy('')
        return
      }
      await addPaper({ id: picked.id, fileName: picked.fileName, title: '课表 ' + picked.fileName.replace(/\.pdf$/i, '') })
      const courses = await parsePdf(picked.id)
      if (!courses.length) throw new Error('未能从 PDF 中识别出课程。可尝试在设置中配置 AI 后重试。')
      setCandidates(courses)
      setSelected(new Set(courses.map((c) => c.id)))
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy('')
    }
  }

  const confirmImport = async () => {
    try {
      if (semesterStart) await save({ semesterStart })
      const picked = candidates.filter((c) => selected.has(c.id))
      if (!picked.length) return
      const r = await addCourses(picked)
      toast(`课表导入完成：新增 ${r.added} 门${r.merged ? `，去重合并 ${r.merged} 门` : ''}`, 'ok')
      onClose()
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const editCourse = (id: string, patch: Partial<Course>) => {
    setCandidates(candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={busy ? undefined : onClose}>
      <div
        className="flex max-h-[85vh] w-[720px] flex-col rounded-xl border border-line bg-bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold">导入课表 PDF</h3>
        {!candidates.length ? (
          <div className="flex-1">
            <div className="mb-4 text-sm text-txt-dim">
              支持常见「表格网格式」课表（列=星期、行=节次）。解析后可逐条校对修正；识别失败时可使用 AI 智能解析（需在设置中配置 API Key）。
            </div>
            {busy && <div className="mb-3 animate-pulse text-sm text-accent">{busy}</div>}
            {error && <div className="mb-3 rounded bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
            <div className="flex items-end gap-3">
              <button className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90" onClick={pickAndParse} disabled={!!busy}>
                选择课表 PDF 并解析
              </button>
              <div>
                <label className="mb-1 block text-xs text-txt-dim">学期第一周周一（可稍后设置）</label>
                <input
                  type="date"
                  value={semesterStart}
                  onChange={(e) => setSemesterStart(e.target.value)}
                  className="rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-txt-dim">识别到 {candidates.length} 门课程，请勾选并校对：</span>
              <button className="rounded-md border border-line px-2 py-0.5 text-xs text-txt-dim hover:border-accent hover:text-accent" onClick={() => setCandidates([])}>
                重新选择文件
              </button>
            </div>
            <div className="mb-3 flex items-center gap-2">
              <label className="text-xs text-txt-dim">学期第一周周一</label>
              <input
                type="date"
                value={semesterStart}
                onChange={(e) => setSemesterStart(e.target.value)}
                className="rounded-lg border border-line bg-bg-soft px-2 py-1 text-sm outline-none focus:border-accent"
              />
            </div>
            <div className="mb-3 max-h-[46vh] flex-1 space-y-2 overflow-y-auto pr-1">
              {candidates.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg-soft p-2.5">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-accent" />
                  <input
                    value={c.name}
                    onChange={(e) => editCourse(c.id, { name: e.target.value })}
                    className="w-40 rounded border border-line bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                  <select
                    value={c.day}
                    onChange={(e) => editCourse(c.id, { day: Number(e.target.value) })}
                    className="rounded border border-line bg-bg px-2 py-1 text-sm outline-none"
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <option key={d} value={d}>
                        {DAY_LABEL[d]}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-txt-dim">第</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={c.startPeriod}
                    onChange={(e) => editCourse(c.id, { startPeriod: Number(e.target.value) })}
                    className="w-14 rounded border border-line bg-bg px-2 py-1 text-sm outline-none"
                  />
                  <span className="text-xs text-txt-dim">~</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={c.endPeriod}
                    onChange={(e) => editCourse(c.id, { endPeriod: Number(e.target.value) })}
                    className="w-14 rounded border border-line bg-bg px-2 py-1 text-sm outline-none"
                  />
                  <span className="text-xs text-txt-dim">节</span>
                  <input
                    value={c.weeksText ?? ''}
                    onChange={(e) => editCourse(c.id, { weeksText: e.target.value })}
                    placeholder="周次 如 1-16"
                    className="w-24 rounded border border-line bg-bg px-2 py-1 text-sm outline-none"
                  />
                  <input
                    value={c.room ?? ''}
                    onChange={(e) => editCourse(c.id, { room: e.target.value })}
                    placeholder="教室"
                    className="w-24 rounded border border-line bg-bg px-2 py-1 text-sm outline-none"
                  />
                  <input
                    value={c.teacher ?? ''}
                    onChange={(e) => editCourse(c.id, { teacher: e.target.value })}
                    placeholder="教师"
                    className="w-20 rounded border border-line bg-bg px-2 py-1 text-sm outline-none"
                  />
                </div>
              ))}
            </div>
            {error && <div className="mb-2 rounded bg-red-500/10 p-2 text-sm text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              <button className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-bg-hover" onClick={onClose}>
                取消
              </button>
              <button
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                onClick={confirmImport}
                disabled={!selected.size}
              >
                导入所选（{selected.size}）
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
