export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function today(): string {
  return toDateStr(new Date())
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 学期内第几周（semesterStart 为第一周周一） */
export function weekOf(semesterStart: string, date: string): number {
  if (!semesterStart) return 1
  const a = new Date(semesterStart + 'T00:00:00').getTime()
  const b = new Date(date + 'T00:00:00').getTime()
  return Math.floor((b - a) / (7 * 86400000)) + 1
}

export function dateOfWeek(semesterStart: string, week: number, day: number): string {
  if (!semesterStart) return today()
  const a = new Date(semesterStart + 'T00:00:00').getTime()
  const d = new Date(a + ((week - 1) * 7 + (day - 1)) * 86400000)
  return toDateStr(d)
}

/** 解析 "1-16" / "1-8,10-16" / "1-16(单)" 周次文本 → 布尔数组(20周) */
export function parseWeeks(text?: string): boolean[] {
  const weeks = new Array(25).fill(false)
  if (!text) return weeks.map(() => true)
  const t = text.replace(/周/g, '')
  const odd = /单|odd/i.test(text)
  const even = /双|even/i.test(text)
  for (const part of t.split(/[,，、;；]/)) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–~]\s*(\d+))?$/)
    if (!m) continue
    const a = parseInt(m[1])
    const b = m[2] ? parseInt(m[2]) : a
    for (let i = a; i <= b && i < 25; i++) {
      if (i < 1) continue
      if (odd && i % 2 === 0) continue
      if (even && i % 2 === 1) continue
      weeks[i - 1] = true
    }
  }
  return weeks.some(Boolean) ? weeks : weeks.map(() => true)
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export function download(fileName: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
