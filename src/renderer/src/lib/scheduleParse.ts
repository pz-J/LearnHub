import type { Course } from '@/types'
import { COURSE_COLORS } from '@/types'
import { uid } from './ipc'

const DAY_NAMES: Record<string, number> = {
  星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 7, 星期天: 7,
  周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 7, 周天: 7,
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
  mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7
}

const COURSE_STOPWORDS = new Set([
  '课程名称', '上课时间', '教室', '教师', '周次', '星期', '节次', '上午', '下午', '晚上',
  '第一节', '第二节', '第三节', '第四节', '第五节', '第六节', '第七节', '第八节',
  '第九节', '第十节', '第十一节', '第十二节'
])

interface Cell {
  text: string
  col: number
  rowTop: number
  rowBottom: number
}

/**
 * 启发式课表解析：基于网格表格（列=星期、行=节次）的 PDF。
 * 输入为 pdfjs 文本项（含坐标），输出候选课程。
 */
export function parseScheduleGrid(
  items: { str: string; x: number; y: number; w: number; h: number }[],
  colorIdx: () => number
): Course[] {
  if (!items.length) return []
  // 1. 找表头行：包含 >=3 个星期词的 y 带
  const dayHits: { day: number; x: number; y: number }[] = []
  for (const it of items) {
    const s = it.str.trim()
    for (const [name, day] of Object.entries(DAY_NAMES)) {
      if (s === name || s.replace(/\s/g, '') === name) {
        dayHits.push({ day, x: it.x + it.w / 2, y: it.y })
        break
      }
    }
  }
  if (dayHits.length < 3) return []
  // 表头 y：取星期词最多的 y 带
  const yBands = new Map<number, number>()
  for (const d of dayHits) {
    const key = Math.round(d.y / 8)
    yBands.set(key, (yBands.get(key) ?? 0) + 1)
  }
  const headerBand = [...yBands.entries()].sort((a, b) => b[1] - a[1])[0][0] * 8
  const header = dayHits.filter((d) => Math.abs(d.y - headerBand) < 14)
  // 列边界：每列中心 ±(列宽/2)
  header.sort((a, b) => a.x - b.x)
  const colCenters = header.map((h) => ({ day: h.day, x: h.x }))

  // 2. 找节次列（最左列）：1-12 或 一、二…等
  const leftItems = items.filter((it) => colCenters.length && it.x + it.w < colCenters[0].x - 10)
  const periodRows: { period: number; yTop: number; yBottom: number }[] = []
  for (const it of items) {
    const s = it.str.trim()
    const m = s.match(/^(?:第)?([0-9一二三四五六七八九十]{1,2})节$/)
    if (!m) continue
    const period = /^第/.test(s) || /[0-9]/.test(m[1]) ? cnNum(m[1]) : cnNum(m[1])
    const rowTop = it.y - it.h / 2
    periodRows.push({ period, yTop: rowTop, yBottom: it.y + it.h / 2 })
  }
  periodRows.sort((a, b) => a.yTop - b.yTop)
  if (!periodRows.length) return []

  // 3. 把表头下方的文本项按（列, 行带）分桶
  const tableBottom = Math.max(...items.map((i) => i.y)) + 5
  const buckets = new Map<string, Cell[]>()
  for (const it of items) {
    if (it.y >= headerBand - 4) continue
    if (it.y < periodRows[0].yTop - 30) continue
    const col = colAt(colCenters, it.x + it.w / 2)
    if (col == null) continue
    const s = it.str.trim()
    if (!s || COURSE_STOPWORDS.has(s)) continue
    const rowTop = nearestRowTop(periodRows, it.y)
    if (rowTop == null) continue
    const key = `${col}|${rowTop}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push({ text: s, col, rowTop, rowBottom: it.y })
  }

  // 4. 相邻行带同名课程合并为连续节次
  const courses: Course[] = []
  const byColRow = new Map<string, Cell[]>()
  for (const [key, cells] of buckets) {
    const text = cells
      .map((c) => c.text)
      .join(' ')
      .trim()
    if (!text) continue
    byColRow.set(key, cells)
  }

  // 合并：同列中，名称相同且行带相邻的格子
  const seen = new Set<string>()
  for (const [key, cells] of byColRow) {
    if (seen.has(key)) continue
    const [colStr, rowTopStr] = key.split('|')
    const col = parseInt(colStr)
    let rowTop = parseInt(rowTopStr)
    const name = primaryName(cells.map((c) => c.text))
    if (!name) continue
    let endRowTop = rowTop
    // 向下合并
    for (;;) {
      const next = findNextRow(byColRow, col, endRowTop, name)
      if (next == null) break
      seen.add(`${col}|${next}`)
      endRowTop = next
    }
    const allCells = [...cells, ...collectMerged(byColRow, col, rowTop, endRowTop, seen, key)]
    const startPeriod = periodAt(periodRows, rowTop)
    const endPeriod = periodAt(periodRows, endRowTop)
    if (startPeriod == null || endPeriod == null) continue
    const full = allCells.map((c) => c.text).join(' ')
    courses.push({
      id: uid('c_'),
      name,
      teacher: extractTeacher(full),
      room: extractRoom(full),
      day: colCenters[col]?.day ?? 1,
      startPeriod,
      endPeriod,
      weeksText: extractWeeks(full) ?? undefined,
      color: COURSE_COLORS[colorIdx() % COURSE_COLORS.length]
    })
  }
  return courses
}

function cnNum(s: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if (/^\d+$/.test(s)) return parseInt(s)
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (map[s[1]] ?? 0)
  if (s.endsWith('十')) return (map[s[0]] ?? 1) * 10
  if (s.includes('十')) return (map[s[0]] ?? 1) * 10 + (map[s[1]] ?? 0)
  return map[s] ?? 1
}

function colAt(colCenters: { day: number; x: number }[], x: number): number | null {
  if (!colCenters.length) return null
  const gaps = colCenters
    .slice(1)
    .map((c, i) => c.x - colCenters[i].x)
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 80
  let best = -1
  let bestDist = Infinity
  colCenters.forEach((c, i) => {
    const d = Math.abs(c.x - x)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return bestDist <= avgGap * 0.65 ? best : null
}

function nearestRowTop(periodRows: { period: number; yTop: number; yBottom: number }[], y: number): number | null {
  let best: number | null = null
  let bestDist = Infinity
  for (const r of periodRows) {
    const d = y < r.yTop ? r.yTop - y : y > r.yBottom + 12 ? y - r.yBottom : 0
    if (d < bestDist) {
      bestDist = d
      best = Math.round(r.yTop)
    }
  }
  return bestDist < 60 ? best : null
}

function periodAt(periodRows: { period: number; yTop: number }[], rowTop: number): number | null {
  let best: number | null = null
  let bestDist = Infinity
  for (const r of periodRows) {
    const d = Math.abs(r.yTop - rowTop)
    if (d < bestDist) {
      bestDist = d
      best = r.period
    }
  }
  return bestDist < 40 ? best : null
}

function primaryName(texts: string[]): string | null {
  // 最长的、非教室/周次/教师样式的文本作为课程名
  const candidates = texts.filter((t) => {
    if (COURSE_STOPWORDS.has(t)) return false
    if (/^\d+-\d+$/.test(t)) return false
    if (/^[A-ZＡ-Ｚ]?\d{2,4}([,-]\d+)?$/i.test(t.trim())) return false // 教室
    if (/^周[\d\-,,，、\s]+$/i.test(t)) return false
    return true
  })
  if (!candidates.length) return null
  return candidates.sort((a, b) => b.length - a.length)[0].replace(/\s+/g, '')
}

function findNextRow(
  byColRow: Map<string, Cell[]>,
  col: number,
  currentRowTop: number,
  name: string
): number | null {
  const rows = [...byColRow.keys()]
    .filter((k) => k.startsWith(`${col}|`))
    .map((k) => parseInt(k.split('|')[1]))
    .sort((a, b) => a - b)
  const idx = rows.indexOf(currentRowTop)
  if (idx === -1 || idx === rows.length - 1) return null
  const next = rows[idx + 1]
  const cells = byColRow.get(`${col}|${next}`)
  if (!cells) return null
  if (primaryName(cells.map((c) => c.text)) === name) return next
  return null
}

function collectMerged(
  byColRow: Map<string, Cell[]>,
  col: number,
  rowTop: number,
  endRowTop: number,
  seen: Set<string>,
  firstKey: string
): Cell[] {
  const out: Cell[] = []
  for (const [k, cells] of byColRow) {
    if (k === firstKey) continue
    const [c, r] = k.split('|')
    if (parseInt(c) === col && parseInt(r) > rowTop && parseInt(r) <= endRowTop) {
      seen.add(k)
      out.push(...cells)
    }
  }
  return out
}

function extractTeacher(text: string): string | undefined {
  const m = text.match(/(?:教授|讲师|副教授|博士)?[：:]?\s*([\u4e00-\u9fa5]{2,4})(?:教授|讲师|副教授)/)
  if (m) return m[0].replace(/[：:]/g, '')
  // 常见格式：课程名 王某某 教室
  const names = text.match(/[\u4e00-\u9fa5]{2,3}(?=\s*[A-ZＡ-Ｚ]?\d{2,4})/)
  return names?.[0] ?? undefined
}

function extractRoom(text: string): string | undefined {
  const m =
    text.match(/[\u4e00-\u9fa5]{1,6}[楼栋区]\s*[-–]?\s*\d{3,4}/) ||
    text.match(/[A-ZＡ-Ｚ]\s*[-–]?\s*\d{3,4}/) ||
    text.match(/\d{3,4}(?=\s|$)/)
  return m?.[0]?.replace(/\s+/g, '') ?? undefined
}

function extractWeeks(text: string): string | null {
  const m = text.match(/(\d+[\d\-,,，、\s]*\d)\s*周/)
  return m ? m[0] : null
}

/** 从逐页文本生成候选课表（纯文本启发式的兜底） */
export function parseScheduleText(pages: { page: number; text: string }[]): string[] {
  const lines: string[] = []
  for (const p of pages) lines.push(...p.text.split('\n'))
  return lines.filter((l) => l.trim().length > 3).slice(0, 200)
}
