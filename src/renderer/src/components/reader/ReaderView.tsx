import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pdfjsLib } from '@/lib/pdf'
import { lh } from '@/lib/ipc'
import { useUi } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { usePapers } from '@/stores/papers'
import { useFlashcards } from '@/stores/flashcards'
import { useReaderState } from '@/stores/readerState'
import { eventBus, EVENTS } from '@/kernel/eventBus'
import { truncate } from '@/lib/utils'

const HL_COLORS = ['#ffd54d', '#8ef0c2', '#9dc0ff', '#f7a8c4']

interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

const normText = (t: string) => t.replace(/\s+/g, '').toLowerCase()

const topBtn = 'rounded border border-line px-2 py-1 text-xs hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40'

/** 在文本层 DOM 中查找目标文本的所有出现位置（去空白匹配），返回每次出现的归一化矩形组 */
function findTextRects(root: HTMLElement, target: string, wrap: HTMLElement, limit = 5): NormRect[][] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const chars: { c: string; node: Text; offset: number }[] = []
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n.nodeValue ?? ''
    for (let i = 0; i < t.length; i++) {
      if (!/\s/.test(t[i])) chars.push({ c: t[i].toLowerCase(), node: n as Text, offset: i })
    }
  }
  const seq = chars.map((x) => x.c).join('')
  const pat = normText(target)
  if (!pat) return []
  const wr = wrap.getBoundingClientRect()
  const out: NormRect[][] = []
  let from = 0
  while (out.length < limit) {
    const idx = seq.indexOf(pat, from)
    if (idx < 0) break
    from = idx + 1
    const a = chars[idx]
    const b = chars[idx + pat.length - 1]
    const range = document.createRange()
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset + 1)
    const rects: NormRect[] = []
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue
      rects.push({
        x: (r.left - wr.left) / wr.width,
        y: (r.top - wr.top) / wr.height,
        w: r.width / wr.width,
        h: r.height / wr.height
      })
    }
    if (rects.length) out.push(rects)
  }
  return out
}

/** 在原始文本中定位归一化匹配，截取命中处的上下文摘要（全文搜索结果用） */
function snippetAround(raw: string, pat: string): string {
  const chars: { c: string; i: number }[] = []
  for (let i = 0; i < raw.length; i++) if (!/\s/.test(raw[i])) chars.push({ c: raw[i].toLowerCase(), i })
  const seq = chars.map((x) => x.c).join('')
  const idx = seq.indexOf(pat)
  if (idx < 0) return ''
  const start = chars[idx].i
  const end = chars[Math.min(seq.length - 1, idx + pat.length - 1)].i
  return raw.slice(Math.max(0, start - 36), Math.min(raw.length, end + 48)).replace(/\s+/g, ' ').trim()
}

/** 「收为答案」在原文自动打的答案标记色（绿色，与手动黄色标记区分） */
const ANSWER_COLOR = '#37c99e'

/** 两个归一化矩形是否为同一位置（容差匹配） */
const sameRect = (a: NormRect, b: NormRect) => Math.abs(a.x - b.x) < 0.003 && Math.abs(a.y - b.y) < 0.003 && Math.abs(a.w - b.w) < 0.01

/** 论文阅读器：pdfjs 渲染 + 文本层 + 高亮层 + 选区工具条 + 批注 */
export function ReaderView() {
  const paperId = useUi((s) => s.activePaperId)
  const navigate = useUi((s) => s.navigate)
  const setSidebarTab = useUi((s) => s.setSidebarTab)
  const toast = useUi((s) => s.toast)
  const paper = usePapers((s) => (paperId ? s.papers[paperId] : undefined))
  const zoom = useSettings((s) => s.settings.reader.zoom)

  const docRef = useRef<PDFDocumentProxy | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pageAreaRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const taskRef = useRef<{ cancel: () => void } | null>(null)

  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [vp, setVp] = useState({ w: 640, h: 860 })
  const [sel, setSel] = useState<{ text: string; rects: NormRect[]; toolbar: { x: number; y: number } } | null>(null)
  const [noteTarget, setNoteTarget] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [explainDraft, setExplainDraft] = useState('')
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const modButtons = useReaderState((s) => s.toolbarButtons)
  const flashId = useReaderState((s) => s.flashHighlightId)

  // ---------- 阅读器增强状态：面板 / 全文搜索 / 夜间反色 / 锁定高亮色 ----------
  const [panel, setPanel] = useState<'none' | 'outline' | 'thumbs'>('none')
  const panelRef = useRef<HTMLDivElement>(null)
  const [outline, setOutline] = useState<{ title: string; page: number; depth: number }[] | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ page: number; snippet: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [searchHits, setSearchHits] = useState<NormRect[]>([])
  // 引用内链热区（点击 [12] 类引用标注直达目标页；hit-test 实现，无 DOM 覆盖）
  const [linkAreas, setLinkAreas] = useState<{ r: NormRect; page: number }[]>([])
  // 悬停中的引用内链索引（精确到具体链接，避免同目标页的多处链接一起高亮）
  const [hoverLink, setHoverLink] = useState<number | null>(null)
  const [hitList, setHitList] = useState<NormRect[][]>([])
  const [hitIdx, setHitIdx] = useState(0)
  const hitListRef = useRef<NormRect[][]>([])
  const hitIdxRef = useRef(0)
  hitListRef.current = hitList
  hitIdxRef.current = hitIdx
  const [night, setNight] = useState(() => localStorage.getItem('lh:reader:night') === '1')
  const [lockColor, setLockColor] = useState<string | null>(null)
  const [pageInput, setPageInput] = useState('1')
  // 自动滚屏：0=关 1=慢 2=快；任何手动滚轮/按下/翻页/Esc 均停止
  const [autoScroll, setAutoScroll] = useState<0 | 1 | 2>(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pendingSearch = useRef<{ page: number; need: boolean }>({ page: 1, need: false })
  const searchOpenRef = useRef(false)
  searchOpenRef.current = searchOpen
  const panelStateRef = useRef(panel)
  panelStateRef.current = panel
  const queryRef = useRef('')
  const lastColorRef = useRef(HL_COLORS[0])
  queryRef.current = query
  // 最近完成渲染的页码：区分「翻页」与「缩放重渲染」（缩放后命中坐标为归一化值仍有效，不应清空）
  const renderedPageRef = useRef(0)
  // 页码输入框跟随实际页（键盘翻页/按钮/缩略图跳页时保持一致）
  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  const update = usePapers((s) => s.update)
  const addHighlight = usePapers((s) => s.addHighlight)
  const updateHighlight = usePapers((s) => s.updateHighlight)
  const removeHighlight = usePapers((s) => s.removeHighlight)
  // 缩放前记录滚动比例、渲染完成后恢复，保证 Ctrl+滚轮/快捷键/复位缩放都不丢当前阅读位置
  const zoomRestoreRef = useRef<number | null>(null)
  const zoomTo = (next: number) => {
    const sc = wrapRef.current?.parentElement
    if (sc) zoomRestoreRef.current = sc.scrollTop / Math.max(1, sc.scrollHeight - sc.clientHeight)
    void useSettings.getState().update({ reader: { ...useSettings.getState().settings.reader, zoom: next } })
  }
  const highlights = paper?.highlights ?? []
  const pageHls = highlights.filter((h) => h.page === page)

  /** 标记解释自动同步：已解释过的文本在本页再次出现时自动补标（继承解释，无需重复标记） */
  const syncAutoHighlights = useCallback(() => {
    const wrap = wrapRef.current
    const textDiv = textRef.current
    if (!wrap || !textDiv || !paperId) return
    const p = usePapers.getState().papers[paperId]
    if (!p) return
    for (const src of p.highlights) {
      if (src.isAuto) continue
      const norm = normText(src.text)
      const covered = p.highlights.filter((x) => x.page === page && normText(x.text) === norm)
      for (const occ of findTextRects(textDiv, src.text, wrap)) {
        // 该出现位置已有同文本标记（手动或自动）→ 跳过
        if (covered.some((c) => c.rects.some((r1) => occ.some((r2) => sameRect(r1, r2))))) continue
        addHighlight(paperId, { page, rects: occ, text: src.text, color: src.color, note: src.note, aiExplain: src.aiExplain, isAuto: true })
      }
    }
  }, [page, paperId, addHighlight])

  // ---------- 全文搜索 ----------
  /** 全文档各页文本缓存（首次搜索构建，后续复用；换论文时重置） */
  const docTextCacheRef = useRef<Promise<string[]> | null>(null)
  /** 搜索序号：连点查找时丢弃过期结果，防竞态覆盖 */
  const searchSeqRef = useRef(0)
  /** 在当前页文本层定位全部命中并滚动到指定处（页面渲染完成后调用） */
  const locateSearchHits = useCallback(() => {
    const wrap = wrapRef.current
    const textDiv = textRef.current
    const q = queryRef.current.trim()
    if (!wrap || !textDiv || !q) return
    const occs = findTextRects(textDiv, q, wrap, 200)
    setSearchHits(occs.flat())
    setHitList(occs)
    setHitIdx(occs.length ? 1 : 0)
    const first = occs[0]?.[0]
    const scroller = wrap.parentElement
    if (first && scroller) scroller.scrollTo({ top: first.y * wrap.offsetHeight + wrap.offsetTop - scroller.clientHeight / 3, behavior: 'smooth' })
  }, [])

  /** 跳到当前页第 i 处命中（循环） */
  const gotoHit = (i: number) => {
    const list = hitListRef.current
    if (!list.length) return
    const idx = ((i % list.length) + list.length) % list.length
    setHitIdx(idx)
    const first = list[idx]?.[0]
    const wrap = wrapRef.current
    const scroller = wrap?.parentElement
    if (first && wrap && scroller) scroller.scrollTo({ top: first.y * wrap.offsetHeight + wrap.offsetTop - scroller.clientHeight / 3, behavior: 'smooth' })
  }

  const runSearch = async () => {
    const doc = docRef.current
    const q = query.trim()
    if (!doc || !q) {
      setResults([])
      return
    }
    const seq = ++searchSeqRef.current
    setSearching(true)
    try {
      // 首次搜索构建全文档文本缓存，重复搜索免重复 getTextContent（大 PDF 提速明显）
      if (!docTextCacheRef.current) {
        const building = (async () => {
          const pages: string[] = []
          for (let p = 1; p <= doc.numPages; p++) {
            const pg = await doc.getPage(p)
            const tc = await pg.getTextContent()
            pages.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(''))
          }
          return pages
        })()
        building.catch(() => {
          if (docTextCacheRef.current === building) docTextCacheRef.current = null // 构建失败允许重试
        })
        docTextCacheRef.current = building
      }
      const pages = await docTextCacheRef.current
      if (seq !== searchSeqRef.current) return
      const pat = normText(q)
      const out: { page: number; snippet: string }[] = []
      for (let p = 1; p <= pages.length && out.length < 50; p++) {
        const raw = pages[p - 1]
        const chars: string[] = []
        for (let i = 0; i < raw.length; i++) if (!/\s/.test(raw[i])) chars.push(raw[i].toLowerCase())
        const norm = chars.join('')
        let idx = norm.indexOf(pat)
        let count = 0
        let snippet = ''
        while (idx >= 0) {
          count++
          if (!snippet) snippet = snippetAround(raw, pat)
          idx = norm.indexOf(pat, idx + pat.length)
        }
        if (count) out.push({ page: p, snippet: snippet + (count > 1 ? `（${count} 处）` : '') })
      }
      if (seq === searchSeqRef.current) setResults(out)
    } finally {
      if (seq === searchSeqRef.current) setSearching(false)
    }
  }

  const gotoResult = (p: number) => {
    setSearchHits([])
    if (p === page) {
      locateSearchHits()
    } else {
      pendingSearch.current = { page: p, need: true }
      setPage(p)
    }
  }

  // ---------- 加载 PDF ----------
  useEffect(() => {
    let alive = true
    setNumPages(0)
    setPage(1)
    setOutline(null)
    setResults([])
    docTextCacheRef.current = null
    setSearchHits([])
    setSearchOpen(false)
    setPanel('none')
    setAutoScroll(0)
    docRef.current?.destroy()
    docRef.current = null
    if (!paperId) return
    setBusy(true)
    ;(async () => {
      try {
        const buf = (await lh.pdfRead(paperId)) as ArrayBuffer
        if (!alive) return
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
        if (!alive) {
          void doc.destroy()
          return
        }
        docRef.current = doc
        setNumPages(doc.numPages)
        // 记录最近打开的论文（空状态「继续阅读」入口用）
        try {
          localStorage.setItem('lh:lastpaper', paperId)
        } catch {
          // 配额异常静默跳过
        }
        // 阅读位置记忆：重开论文自动回到上次读到的页（提示用户已被记住，超过 1 页才提示）
        const saved = Number(localStorage.getItem('lh:lastpage:' + paperId) ?? 1)
        if (Number.isFinite(saved) && saved >= 1 && saved <= doc.numPages) {
          const p = Math.floor(saved)
          if (p > 1) toast(`已回到上次阅读位置：第 ${p} 页`, 'ok')
          setPage(p)
        }
      } catch (err) {
        toast('PDF 加载失败：' + (err as Error).message, 'error')
      } finally {
        if (alive) setBusy(false)
      }
    })()
    return () => {
      alive = false
      taskRef.current?.cancel()
      void docRef.current?.destroy()
      docRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId])

  // ---------- 阅读位置记忆：翻页即保存，重开论文恢复 ----------
  useEffect(() => {
    if (!paperId || !page) return
    try {
      localStorage.setItem('lh:lastpage:' + paperId, String(page))
    } catch {
      // localStorage 配额/隐私模式异常时静默跳过
    }
  }, [paperId, page])

  // ---------- 页码输入框跟随当前页 ----------
  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  // ---------- 目录大纲：解析 PDF outline 为标题+页码（文档加载完成后执行一次） ----------
  useEffect(() => {
    if (!numPages) return
    let alive = true
    ;(async () => {
      try {
        const doc = docRef.current
        if (!doc) return
        const ol = await doc.getOutline()
        if (!alive) return
        if (!ol || !ol.length) {
          setOutline([])
          return
        }
        const out: { title: string; page: number; depth: number }[] = []
        const walk = async (items: unknown[], depth: number): Promise<void> => {
          for (const raw of items) {
            const it = raw as { title?: string; dest?: unknown; items?: unknown[] }
            let pg = 0
            try {
              let dest = it.dest
              if (typeof dest === 'string') dest = await doc.getDestination(dest)
              if (Array.isArray(dest) && dest.length && dest[0]) pg = (await doc.getPageIndex(dest[0] as Parameters<typeof doc.getPageIndex>[0])) + 1
            } catch {
              /* 无法解析的目标保留为 0，仅展示不可跳转 */
            }
            out.push({ title: it.title || '（无标题）', page: pg, depth })
            if (it.items && it.items.length && depth < 5) await walk(it.items, depth + 1)
          }
        }
        await walk(ol, 0)
        if (alive) setOutline(out)
      } catch {
        if (alive) setOutline([])
      }
    })()
    return () => {
      alive = false
    }
  }, [numPages])

  // ---------- 缩略图面板打开/翻页时，把当前页缩略图滚动到可见 ----------
  useEffect(() => {
    if (panel !== 'thumbs') return
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector('[data-pg-current]')?.scrollIntoView({ block: 'center' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [panel, page])

  // ---------- 渲染当前页 ----------
  useEffect(() => {
    const doc = docRef.current
    const canvas = canvasRef.current
    const textDiv = textRef.current
    if (!doc || !canvas || !textDiv || page < 1 || page > doc.numPages) return
    let alive = true
    // 自动滚屏翻页：渲染开始即回到页顶（渲染失败也不残留上一页底部位置）
    if (pendingAutoNext.current) {
      const sc = wrapRef.current?.parentElement
      if (sc) sc.scrollTop = 0
    }
    ;(async () => {
      try {
        taskRef.current?.cancel()
        const pg = await doc.getPage(page)
        if (!alive) return
        const scale = 1.5 * zoom
        const dpr = window.devicePixelRatio || 1
        const viewport = pg.getViewport({ scale })
        setVp({ w: viewport.width, h: viewport.height })
        // 缩放触发的渲染：完成后按记录的比例恢复滚动位置（双 rAF 等 DOM 高度生效）
        if (zoomRestoreRef.current != null) {
          const ratio = zoomRestoreRef.current
          zoomRestoreRef.current = null
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const sc = wrapRef.current?.parentElement
              if (sc) sc.scrollTop = ratio * Math.max(0, sc.scrollHeight - sc.clientHeight)
            })
          )
        }
        const ctx = canvas.getContext('2d')!
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = viewport.width + 'px'
        canvas.style.height = viewport.height + 'px'
        const task = pg.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
        taskRef.current = task
        await task.promise
        if (!alive) return
        // 文本层
        textDiv.innerHTML = ''
        textDiv.style.width = viewport.width + 'px'
        textDiv.style.height = viewport.height + 'px'
        textDiv.style.setProperty('--total-scale-factor', String(viewport.scale))
        textDiv.style.setProperty('--scale-factor', String(viewport.scale))
        const tc = await pg.getTextContent()
        if (!alive) return
        // 引用内链解析：PDF 注释中的内部跳转目标（点击 [12] 类引用直达目标页）
        try {
          const anns = await pg.getAnnotations()
          if (!alive) return
          const links: { r: NormRect; page: number }[] = []
          for (const a of anns) {
            if (a.subtype !== 'Link' || a.url) continue
            const d = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest
            if (!Array.isArray(d) || !d[0]) continue
            const idx = await doc.getPageIndex(d[0] as never)
            const vr = viewport.convertToViewportRectangle(a.rect as never)
            const x = Math.min(vr[0], vr[2])
            const y = Math.min(vr[1], vr[3])
            const w = Math.abs(vr[2] - vr[0])
            const h = Math.abs(vr[3] - vr[1])
            if (w < 1 || h < 1) continue
            links.push({ r: { x: x / viewport.width, y: y / viewport.height, w: w / viewport.width, h: h / viewport.height }, page: idx + 1 })
          }
          if (alive) setLinkAreas(links)
        } catch {
          if (alive) setLinkAreas([])
        }
        const TL = (pdfjsLib as unknown as { TextLayer: new (o: unknown) => { render: () => Promise<void> } }).TextLayer
        if (TL) {
          const layer = new TL({ textContentSource: tc, container: textDiv, viewport })
          await layer.render()
          if (!alive) return
          syncAutoHighlights()
          // 搜索结果跳转到位：本页渲染完成后定位全部命中并滚动
          if (pendingSearch.current.need && pendingSearch.current.page === page) {
            pendingSearch.current.need = false
            locateSearchHits()
          } else if (renderedPageRef.current !== page) {
            // 手动翻页：命中列表属于上一页，清空避免 Enter/F3 用旧页坐标在新页滚动
            setSearchHits([])
            setHitList([])
            setHitIdx(0)
            setLinkAreas([])
          }
          renderedPageRef.current = page
          // 自动滚屏翻页就位：放开 interval 继续滚动（页顶重置已在渲染开始时完成）
          if (pendingAutoNext.current) pendingAutoNext.current = false
        }
      } catch {
        // 渲染被取消等情况：放开自动翻页标记，避免自动滚屏假死
        // （仅本次渲染仍活跃时放开；effect 已被清理说明是新渲染接管，翻页标记由新渲染自行管理）
        if (alive) pendingAutoNext.current = false
      }
    })()
    return () => {
      alive = false
      // 立即取消进行中的渲染，避免快速翻页时两个 render 并发写同一 canvas
      taskRef.current?.cancel()
    }
  }, [page, zoom, numPages, syncAutoHighlights, locateSearchHits])

  // ---------- 选区 ----------
  const captureSelection = useCallback((e: React.MouseEvent) => {
    const wrap = wrapRef.current
    const s = window.getSelection()
    if (!wrap || !s || s.isCollapsed || !paperId) return
    const text = s.toString().trim()
    if (!text) return
    const wr = wrap.getBoundingClientRect()
    const rects: NormRect[] = []
    for (let i = 0; i < s.rangeCount; i++) {
      const range = s.getRangeAt(i)
      const list = range.getClientRects().length ? Array.from(range.getClientRects()) : [range.getBoundingClientRect()]
      for (const r of list) {
        if (r.width < 1 || r.height < 1) continue
        rects.push({
          x: (r.left - wr.left) / wr.width,
          y: (r.top - wr.top) / wr.height,
          w: r.width / wr.width,
          h: r.height / wr.height
        })
      }
    }
    if (!rects.length) return
    // 锁定高亮色模式（Zotero 式连刷）：选中即标，免点色圈
    if (lockColor) {
      lastColorRef.current = lockColor
      addHighlight(paperId, { page, rects, text, color: lockColor })
      window.getSelection()?.removeAllRanges()
      toast('已高亮', 'ok')
      syncAutoHighlights()
      return
    }
    useReaderState.getState().setSelection({ text, page, rects })
    setSel({
      text,
      rects,
      // 用鼠标抬起时的视口坐标定位工具条（滚动页面也不会错位）
      toolbar: { x: e.clientX, y: e.clientY }
    })
  }, [page, paperId, lockColor, addHighlight, syncAutoHighlights, toast])

  const clearSel = useCallback(() => {
    setSel(null)
    useReaderState.getState().setSelection(null)
  }, [])

  // 点击发生在阅读器容器之外（搜索 webview / 侧栏等）时，收起选区工具条与快捷菜单，避免残留误导
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t && typeof t.closest === 'function' && t.closest('[data-reader-root]')) return
      setCtx(null)
      setSel(null)
      useReaderState.getState().setSelection(null)
    }
    document.addEventListener('mousedown', onDocDown, true)
    return () => document.removeEventListener('mousedown', onDocDown, true)
  }, [])

  const onContainerMouseDown = (e: React.MouseEvent) => {
    // 点击工具条/菜单本身不清理
    if ((e.target as HTMLElement).closest('[data-sel-toolbar]')) return
    setCtx(null)
    clearSel()
  }

  // 右键：选中文本时弹出快捷菜单（保证始终有搜索入口）
  const onCtxMenu = (e: React.MouseEvent) => {
    if (!sel) return
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY })
  }

  // ---------- 高亮操作 ----------
  const doHighlight = (color: string) => {
    if (!sel || !paperId) return
    lastColorRef.current = color
    addHighlight(paperId, { page, rects: sel.rects, text: sel.text, color })
    window.getSelection()?.removeAllRanges()
    clearSel()
    toast('已高亮', 'ok')
    syncAutoHighlights() // 本页其他相同文本自动补标
  }

  const hitHighlight = (e: React.MouseEvent): string | null => {
    const wrap = wrapRef.current
    if (!wrap) return null
    const wr = wrap.getBoundingClientRect()
    const nx = (e.clientX - wr.left) / wr.width
    const ny = (e.clientY - wr.top) / wr.height
    for (const h of pageHls) {
      for (const r of h.rects) {
        if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) return h.id
      }
    }
    return null
  }

  /** 引用内链 hit-test：返回命中的链接索引（无 DOM 覆盖，不拦截文本选择） */
  const hitLinkArea = (e: React.MouseEvent): number | null => {
    const wrap = wrapRef.current
    if (!wrap || !linkAreas.length) return null
    const wr = wrap.getBoundingClientRect()
    const nx = (e.clientX - wr.left) / wr.width
    const ny = (e.clientY - wr.top) / wr.height
    for (let i = 0; i < linkAreas.length; i++) {
      const l = linkAreas[i]
      if (nx >= l.r.x && nx <= l.r.x + l.r.w && ny >= l.r.y && ny <= l.r.y + l.r.h) return i
    }
    return null
  }

  const onPageMouseMove = (e: React.MouseEvent) => {
    setHoverLink(hitLinkArea(e))
    const id = hitHighlight(e)
    useReaderState.getState().setHover(id)
    if (id) {
      const h = pageHls.find((x) => x.id === id)!
      // 悬停显示解释/答案：批注 → AI 解释 → 归档答案（绿标对应的答案内容）
      const parts: string[] = []
      if (h.note) parts.push(h.note)
      if (h.aiExplain) parts.push(h.aiExplain)
      if (!parts.length) {
        const pap = usePapers.getState().papers[paperId ?? '']
        const ans = (pap?.answers ?? []).find((a) => normText(a.question) === normText(h.text))
        if (ans) parts.push(ans.quote)
      }
      setTip({ x: e.clientX, y: e.clientY, text: parts.join('\n') || '（尚无解释：点标记可添加批注或 AI 解释）' })
    } else {
      setTip(null)
    }
  }

  const onPageClick = (e: React.MouseEvent) => {
    // 引用内链优先：点击 [12] 类标注直达目标页
    const li = hitLinkArea(e)
    if (li != null) {
      setPage(linkAreas[li].page)
      return
    }
    const id = hitHighlight(e)
    if (!id) return
    const h = pageHls.find((x) => x.id === id)!
    setNoteTarget(id)
    setNoteDraft(h.note ?? '')
    setExplainDraft(h.aiExplain ?? '')
    clearSel()
  }

  // ---------- 工具条动作 ----------
  const act = (a: string) => {
    if (!sel || !paperId) return
    const text = sel.text
    switch (a) {
      case 'explain':
        setSidebarTab('ai')
        eventBus.emit('ai:explain', { text, paperId })
        break
      case 'search':
        setSidebarTab('search')
        eventBus.emit('search:open', { text, paperId })
        break
      case 'card':
        void useFlashcards.getState().add({ q: text, a: '', source: { paperId } })
        toast('已加入闪卡，答案可在闪卡页补充', 'ok')
        break
      case 'copy':
        void lh.clipboardWrite(text)
        toast('已复制', 'ok')
        break
      case 'cite': {
        // 引用格式：Markdown 引文 + 文献标题 + 页码
        const pap = usePapers.getState().papers[paperId]
        const cite = `> ${text.replace(/\n+/g, ' ')}\n>\n> —— ${pap?.title ?? '未命名文献'}，第 ${page} 页`
        void lh.clipboardWrite(cite)
        toast('已复制引用', 'ok')
        break
      }
      default:
        if (a.startsWith('hl:')) doHighlight(a.slice(3))
        else if (a.startsWith('mod:')) {
          const [moduleId, btnId] = a.slice(4).split('#')
          eventBus.emit(EVENTS.readerToolbarClick, { moduleId, id: btnId, text, paperId })
        }
    }
  }

  // ---------- 跨组件联动：滚动定位到高亮 ----------
  useEffect(() => {
    const off = eventBus.on(EVENTS.scrollToHighlight, (payload) => {
      const p = payload as { paperId: string; highlightId: string }
      if (!paperId || p.paperId !== paperId) return
      const h = (usePapers.getState().papers[paperId]?.highlights ?? []).find((x) => x.id === p.highlightId)
      if (!h) return
      const go = () => {
        const wrap = wrapRef.current
        if (!wrap) return
        const y = h.rects[0]?.y ?? 0
        const scroller = wrap.parentElement
        scroller?.scrollTo({ top: Math.max(0, y * wrap.offsetHeight + wrap.offsetTop - scroller.clientHeight / 3), behavior: 'smooth' })
        useReaderState.getState().flash(h.id)
      }
      if (h.page !== page) {
        setPage(h.page)
        setTimeout(go, 600)
      } else {
        go()
      }
    })
    return off
  }, [paperId, page])

  // ---------- 跨组件联动：搜索页「收为答案」→ 链路根问题的原文标记升级为答案色（绿色） ----------
  useEffect(() => {
    const off = eventBus.on(EVENTS.markAnswerText, (payload) => {
      const p = payload as { text: string }
      if (!paperId || !p.text) return
      const st = usePapers.getState()
      const pap = st.papers[paperId]
      if (!pap) return
      const norm = normText(p.text)
      const exist = pap.highlights.filter((h) => normText(h.text) === norm)
      if (exist.length) {
        for (const h of exist) void st.updateHighlight(paperId, h.id, { color: ANSWER_COLOR })
        return
      }
      // 该文本从未被标记 → 在当前页自动补一个绿色答案标记
      const wrap = wrapRef.current
      const textDiv = textRef.current
      if (!wrap || !textDiv) return
      const occs = findTextRects(textDiv, p.text, wrap)
      if (!occs.length) return
      void st.addHighlight(paperId, { page, rects: occs[0], text: p.text, color: ANSWER_COLOR })
    })
    return off
  }, [paperId, page])

  useEffect(() => {
    eventBus.emit(EVENTS.paperOpened, { paperId })
  }, [paperId])

  // ---------- 快捷键：←/→/PgUp/PgDn 翻页，Ctrl+F 全文搜索，Ctrl+= / Ctrl+- 缩放，Esc 关面板 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inInput = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        setResults([])
        requestAnimationFrame(() => searchInputRef.current?.focus())
        return
      }
      const st = useSettings.getState().settings.reader
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomTo(Math.min(2.5, +(st.zoom + 0.1).toFixed(2)))
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        zoomTo(Math.max(0.5, +(st.zoom - 0.1).toFixed(2)))
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        // 复位缩放到 100%
        e.preventDefault()
        zoomTo(1)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        // Ctrl+Z 撤销最近一次高亮；输入框内让位给原生文本撤销
        if (inInput) return
        e.preventDefault()
        if (!paperId) return
        const ps = usePapers.getState()
        const pap = ps.papers[paperId]
        const last = pap?.highlights[pap.highlights.length - 1]
        if (last) {
          void ps.removeHighlight(paperId, last.id)
          toast('已撤销上一个高亮', 'ok')
        }
        return
      }
      if (inInput || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((p) => Math.max(1, p - 1))
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((p) => Math.min(numPages || 1, p + 1))
      else if (e.key === 'Enter' || e.key === 'F3') {
        // 全局循环跳转本页搜索命中（无需聚焦搜索框）
        if (hitListRef.current.length) gotoHit(hitIdxRef.current)
      } else if (e.key === 'Escape') {
        // 逐层关闭：右键菜单 > 搜索面板 > 目录/标注侧面板 > 停自动滚屏
        setCtx(null)
        if (searchOpenRef.current) setSearchOpen(false)
        else if (panelStateRef.current !== 'none') setPanel('none')
        else setAutoScroll(0) // Esc 停止自动滚屏
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [numPages, paperId])

  // ---------- Ctrl+滚轮 / 触控板捏合缩放（普通滚轮保持页面滚动；合成 onWheel 为 passive，必须原生监听） ----------
  useEffect(() => {
    const el = pageAreaRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const st = useSettings.getState().settings.reader
      zoomTo(Math.min(2.5, Math.max(0.5, +(st.zoom + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(2))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---------- 自动滚屏：定时步进滚动，滚到底自动翻下一页续读（末页自动关） ----------
  const pendingAutoNext = useRef(false)
  const numPagesRef = useRef(0)
  numPagesRef.current = numPages
  useEffect(() => {
    if (!autoScroll) return
    const scroller = wrapRef.current?.parentElement
    if (!scroller) return
    const t = window.setInterval(() => {
      if (pendingAutoNext.current) return // 翻页渲染中，等待新页就位
      scroller.scrollTop += autoScroll
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) {
        const cur = renderedPageRef.current
        if (cur > 0 && cur < numPagesRef.current) {
          pendingAutoNext.current = true
          setPage(cur + 1)
        } else {
          setAutoScroll(0)
          useUi.getState().toast('已自动滚到末页，自动滚屏关闭', 'ok')
        }
      }
    }, 24)
    return () => window.clearInterval(t)
  }, [autoScroll])

  // 自动滚屏期间任何手动操作（滚轮/按下/触摸）立即停止
  useEffect(() => {
    if (!autoScroll) return
    const el = pageAreaRef.current
    if (!el) return
    const stop = () => setAutoScroll(0)
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('mousedown', stop)
    el.addEventListener('touchstart', stop, { passive: true })
    return () => {
      el.removeEventListener('wheel', stop)
      el.removeEventListener('mousedown', stop)
      el.removeEventListener('touchstart', stop)
    }
  }, [autoScroll])

  if (!paperId || !paper) {
    // 空状态：若之前读过论文，提供「继续阅读」一键恢复（配合页码位置记忆直达上次进度）
    const lastId = (() => {
      try {
        return localStorage.getItem('lh:lastpaper')
      } catch {
        return null
      }
    })()
    const lastPaper = lastId ? usePapers.getState().papers[lastId] : undefined
    const lastPage = lastId && lastPaper ? Number(localStorage.getItem('lh:lastpage:' + lastId) ?? 1) : 0
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-txt-dim">
        <div className="text-4xl text-line">§</div>
        <div>尚未打开论文</div>
        {lastPaper && (
          <button className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90" onClick={() => useUi.getState().openPaper(lastId!)}>
            继续阅读：{truncate(lastPaper.title, 28)}
          </button>
        )}
        {lastPaper && lastPage > 1 && <div className="text-xs">上次读到第 {Math.floor(lastPage)} 页，打开后自动跳回</div>}
        <button className="rounded-lg border border-line px-4 py-2 text-sm text-txt hover:bg-bg-hover" onClick={() => navigate('library')}>
          去文献库选择
        </button>
      </div>
    )
  }

  const noteHl = highlights.find((h) => h.id === noteTarget)

  return (
    <div className="relative flex h-full flex-col overflow-hidden" onMouseDown={onContainerMouseDown}>
      {/* 顶部栏 */}
      <div className="flex items-center gap-2 border-b border-line bg-bg-card px-4 py-2 text-sm">
        <button className={topBtn} onClick={() => navigate('library')}>
          ← 文献库
        </button>
        <span className="min-w-0 flex-1 truncate font-medium">{paper.title}</span>
        <div className="flex items-center gap-1 text-xs">
          <button
            className={topBtn + (panel === 'outline' ? ' border-accent text-accent' : '')}
            title="目录大纲跳转"
            onClick={() => setPanel((v) => (v === 'outline' ? 'none' : 'outline'))}
          >
            目录
          </button>
          <button
            className={topBtn + (panel === 'thumbs' ? ' border-accent text-accent' : '')}
            title="页面缩略图导航，点击跳转"
            onClick={() => setPanel((v) => (v === 'thumbs' ? 'none' : 'thumbs'))}
          >
            页面
          </button>
          <button
            className={topBtn + (searchOpen ? ' border-accent text-accent' : '')}
            title="全文搜索（Ctrl+F）"
            onClick={() => {
              const next = !searchOpen
              setSearchOpen(next)
              if (next) requestAnimationFrame(() => searchInputRef.current?.focus())
              else {
                setResults([])
                setSearchHits([])
              }
            }}
          >
            搜索
          </button>
          <button
            className={topBtn + (night ? ' border-accent text-accent' : '')}
            title="夜间反色，护眼夜读"
            onClick={() =>
              setNight((v) => {
                localStorage.setItem('lh:reader:night', v ? '0' : '1')
                return !v
              })
            }
          >
            夜间
          </button>
          <button
            className={topBtn + (autoScroll ? ' border-accent text-accent' : '')}
            title="自动滚屏：解放双手阅读长文，滚轮/按下/翻页/Esc 停止"
            onClick={() => setAutoScroll((v) => (v === 0 ? 1 : v === 1 ? 2 : 0))}
          >
            {autoScroll ? `自动 ${autoScroll}x` : '自动'}
          </button>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button className={topBtn} disabled={page <= 1} title="上一页（←）" onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <input
            className="w-11 rounded border border-line bg-bg px-1 py-1 text-center text-xs"
            value={pageInput}
            title="输入页码后回车跳转"
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = parseInt(pageInput, 10)
                if (Number.isFinite(n)) setPage(Math.min(Math.max(1, n), numPages || 1))
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            onBlur={() => setPageInput(String(page))}
          />
          <span className="text-txt-dim">/ {numPages || '…'}</span>
          {numPages > 0 && <span className="text-txt-dim">· {Math.round((page / numPages) * 100)}%</span>}
          <button className={topBtn} disabled={page >= numPages} title="下一页（→）" onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            className={topBtn}
            title="缩小（Ctrl+-）"
            onClick={() => zoomTo(Math.max(0.5, +(zoom - 0.1).toFixed(2)))}
          >
            −
          </button>
          <button
            type="button"
            className={topBtn + ' w-10'}
            title="重置缩放为 100%（Ctrl+0）"
            onClick={() => zoomTo(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className={topBtn}
            title="放大（Ctrl+=）"
            onClick={() => zoomTo(Math.min(2.5, +(zoom + 0.1).toFixed(2)))}
          >
            +
          </button>
        </div>
      </div>

      {/* 全文搜索面板 */}
      {searchOpen && (
        <div className="border-b border-line bg-bg-card px-4 py-2" data-reader-root onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex gap-2">
            <input
              ref={searchInputRef}
              className="lh-input flex-1 py-1 text-xs"
              placeholder="全文搜索（Enter 查找 / 再按 Enter 下一处）"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSearchHits([])
                setHitList([])
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // 已有本页命中：Enter 逐处循环；否则执行全文查找（查找中防重复触发）
                  if (hitList.length > 0) gotoHit(hitIdx)
                  else if (!searching) void runSearch()
                }
              }}
            />
            <button type="button" className="lh-button px-3 py-1 text-xs" disabled={searching || !query.trim()} onClick={() => void runSearch()}>
              {searching ? '查找中' : '查找'}
            </button>
            {hitList.length > 0 && (
              <button type="button" className="lh-button px-3 py-1 text-xs" title="跳到下一处命中" onClick={() => gotoHit(hitIdx)}>
                下一处 {hitIdx}/{hitList.length}
              </button>
            )}
            <button
              type="button"
              className="lh-button px-3 py-1 text-xs"
              onClick={() => {
                setSearchOpen(false)
                setResults([])
                setSearchHits([])
              }}
            >
              收起
            </button>
          </div>
          {results.length > 0 && (
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.page}
                  type="button"
                  className="block w-full rounded-md border border-line px-2 py-1.5 text-left text-xs transition-colors hover:border-accent"
                  onClick={() => gotoResult(r.page)}
                >
                  <span className="mr-1.5 rounded bg-bg-soft px-1 py-0.5 text-txt-dim">P{r.page}</span>
                  <span className="text-txt-dim">{r.snippet}</span>
                </button>
              ))}
            </div>
          )}
          {query.trim() && !searching && results.length === 0 && <div className="mt-2 text-xs text-txt-dim">无结果</div>}
        </div>
      )}

      {/* 目录 / 标注 / 缩略图 侧面板 */}
      {panel !== 'none' && (
        <div ref={panelRef} className="absolute right-3 top-14 z-30 max-h-[72%] w-64 overflow-y-auto rounded-lg border border-line bg-bg-card p-2 shadow-xl" data-reader-root>
          {panel === 'thumbs' && docRef.current && numPages > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                <ThumbItem
                  key={p}
                  doc={docRef.current!}
                  page={p}
                  active={p === page}
                  markCount={highlights.filter((h) => h.page === p).length}
                  onJump={(pp) => {
                    setPage(pp)
                    setPanel('none')
                  }}
                />
              ))}
            </div>
          )}
          {panel === 'outline' &&
            (outline === null ? (
              <div className="p-2 text-xs text-txt-dim">目录加载中</div>
            ) : outline.length === 0 ? (
              <div className="p-2 text-xs text-txt-dim">本文档无目录大纲</div>
            ) : (
              outline.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={!o.page}
                  className={`block w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-bg-hover ${o.page ? '' : 'cursor-default text-txt-dim'}`}
                  style={{ paddingLeft: 6 + o.depth * 12 }}
                  title={o.title}
                  onClick={() => {
                    if (o.page) {
                      setPage(o.page)
                      setPanel('none')
                    }
                  }}
                >
                  {o.title}
                  {o.page ? <span className="ml-1 text-txt-dim">· P{o.page}</span> : null}
                </button>
              ))
            ))}
        </div>
      )}

      {/* 页面区 */}
      <div ref={pageAreaRef} className="flex-1 overflow-auto bg-bg-deep p-6" data-reader-root onMouseUp={captureSelection} onContextMenu={onCtxMenu}>
        <div
          ref={wrapRef}
          className="relative mx-auto bg-white shadow-2xl"
          style={{ width: vp.w, height: vp.h, filter: night ? 'invert(0.92) hue-rotate(180deg)' : undefined, cursor: hoverLink != null ? 'pointer' : undefined }}
          onMouseMove={onPageMouseMove}
          onMouseLeave={() => {
            setTip(null)
            setHoverLink(null)
            useReaderState.getState().setHover(null)
          }}
          onClick={onPageClick}
        >
          <canvas ref={canvasRef} className="block" />
          {/* 高亮层（pointer-events 关闭，命中靠 hit-test；闪烁描边用 flashId） */}
          <div className="pointer-events-none absolute inset-0 mix-blend-multiply">
            {pageHls.map((h) =>
              h.rects.map((r, i) => (
                <div
                  key={h.id + i}
                  className="absolute rounded-sm"
                  style={{
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                    background: h.color,
                    opacity: 0.45,
                    boxShadow: flashId === h.id ? '0 0 0 3px #5b8cff' : undefined
                  }}
                />
              ))
            )}
            {/* 全文搜索命中高亮（橙色描边） */}
            {searchHits.map((r, i) => (
              <div
                key={'s' + i}
                className="absolute rounded-sm border border-orange-400/80"
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: 'rgba(255,150,40,0.28)' }}
              />
            ))}
          </div>
          <div ref={textRef} className="textLayer" />
          {/* 引用内链悬停高亮（仅当前悬停的那一处链接；纯视觉层，点击走 wrap 的 hit-test） */}
          {hoverLink != null && linkAreas[hoverLink] && (
            <div
              className="pointer-events-none absolute rounded-sm bg-accent/25"
              style={{
                left: `${linkAreas[hoverLink].r.x * 100}%`,
                top: `${linkAreas[hoverLink].r.y * 100}%`,
                width: `${linkAreas[hoverLink].r.w * 100}%`,
                height: `${linkAreas[hoverLink].r.h * 100}%`
              }}
            />
          )}
          {busy && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">加载中…</div>}
        </div>
      </div>

      {/* 选区浮动工具条（视口固定定位，随鼠标抬起位置出现） */}
      {sel && (
        <div
          data-sel-toolbar
          data-reader-root
          className="fixed z-30 flex items-center gap-0.5 rounded-lg border border-line bg-bg-card p-1 shadow-xl"
          style={{
            left: Math.max(8, Math.min(sel.toolbar.x - 120, window.innerWidth - 300)),
            top: Math.max(8, sel.toolbar.y - 46)
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {HL_COLORS.map((c) => (
            <button
              key={c}
              title="高亮"
              className="h-5 w-5 rounded-full border border-black/20 hover:scale-110"
              style={{ background: c }}
              onClick={() => act('hl:' + c)}
            />
          ))}
          <button
            title={lockColor ? '取消锁定高亮色（当前选中即标）' : '锁定高亮色：之后选中即自动标注，免点色圈'}
            className={`h-5 w-5 rounded-full border text-[9px] leading-none ${
              lockColor ? 'border-accent bg-accent/20 text-accent' : 'border-line bg-bg-soft text-txt-dim hover:border-accent'
            }`}
            onClick={() => setLockColor((v) => (v ? null : lastColorRef.current))}
          >
            锁
          </button>
          <span className="mx-1 h-4 w-px bg-line" />
          <TBtn onClick={() => act('explain')} title="AI 解释此段">
            AI
          </TBtn>
          <TBtn onClick={() => act('search')} title="搜索此段并绑定（路径导图随搜索自动生长）">
            搜
          </TBtn>
          <TBtn onClick={() => act('card')} title="制成闪卡">
            卡
          </TBtn>
          <TBtn onClick={() => act('cite')} title="复制为引用格式（引文+文献标题+页码）">
            引
          </TBtn>
          <TBtn onClick={() => act('copy')} title="复制">
            复
          </TBtn>
          {modButtons.length > 0 && <span className="mx-1 h-4 w-px bg-line" />}
          {modButtons.map((b) => (
            <TBtn key={b.moduleId + '#' + b.id} onClick={() => act(`mod:${b.moduleId}#${b.id}`)} title={b.title}>
              {b.title.slice(0, 2)}
            </TBtn>
          ))}
        </div>
      )}

      {/* 选区右键快捷菜单：保证始终有搜索入口 */}
      {ctx && sel && (
        <div
          data-reader-root
          className="fixed z-40 w-44 rounded-lg border border-line bg-bg-card py-1 shadow-2xl"
          style={{ left: Math.min(ctx.x, window.innerWidth - 190), top: Math.min(ctx.y, window.innerHeight - 200) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ['搜索此段', () => act('search')],
              ['AI 解释', () => act('explain')],
              ['高亮黄色', () => act('hl:' + HL_COLORS[0])],
              ['制成闪卡', () => act('card')],
              ['复制引用', () => act('cite')],
              ['复制', () => act('copy')]
            ] as [string, () => void][]
          ).map(([label, fn]) => (
            <button
              key={label}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-bg-hover"
              onClick={() => {
                fn()
                setCtx(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 高亮 hover 提示 */}
      {tip && (
        <div className="pointer-events-none fixed z-50 max-w-sm rounded-lg border border-line bg-bg-card p-2.5 text-xs leading-5 shadow-xl" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}

      {/* 批注/解释编辑条 */}
      {noteHl && (
        <div className="absolute bottom-0 left-0 right-0 z-30 border-t border-line bg-bg-card p-3" data-reader-root onMouseDown={(e) => e.stopPropagation()}>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-txt-dim">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: noteHl.color }} />
            <span className="min-w-0 flex-1 truncate">{truncate(noteHl.text, 80)}</span>
            <span className="mx-0.5 h-4 w-px bg-line" />
            {HL_COLORS.map((c) => (
              <button
                key={c}
                title="改为该颜色"
                className={`h-4 w-4 shrink-0 rounded-full border transition-transform hover:scale-110 ${
                  noteHl.color.toLowerCase() === c ? 'border-accent ring-1 ring-accent/50' : 'border-black/20'
                }`}
                style={{ background: c }}
                onClick={() => {
                  if (paperId) void updateHighlight(paperId, noteHl.id, { color: c })
                }}
              />
            ))}
            <button
              className="rounded px-2 py-0.5 hover:bg-bg-hover"
              onClick={() => {
                setNoteTarget(null)
              }}
            >
              收起
            </button>
            <button
              className="rounded px-2 py-0.5 text-red-400 hover:bg-red-500/10"
              onClick={() => {
                if (paperId) void removeHighlight(paperId, noteHl.id)
                setNoteTarget(null)
              }}
            >
              删除高亮
            </button>
          </div>
          <textarea
            className="h-14 w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm"
            placeholder="写批注…（会显示在笔记栏，并可在 PDF 上悬停查看）"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => {
              if (paperId) void updateHighlight(paperId, noteHl.id, { note: noteDraft || undefined })
            }}
          />
          <textarea
            className="mt-1.5 h-20 w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm"
            placeholder="写解释…（对这段标记的理解/答案，保存后同步到全文相同标记）"
            value={explainDraft}
            onChange={(e) => setExplainDraft(e.target.value)}
            onBlur={() => {
              if (paperId) void updateHighlight(paperId, noteHl.id, { aiExplain: explainDraft || undefined })
            }}
          />
          <div className="mt-1 text-[11px] text-txt-dim">批注与解释失焦即保存；相同内容的标记会自动同步这份解释。</div>
        </div>
      )}
    </div>
  )
}

function TBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button className="rounded-md border border-line bg-bg-soft px-1.5 py-0.5 text-[11px] text-txt-dim hover:border-accent hover:text-accent" title={title} onClick={onClick}>
      {children}
    </button>
  )
}

/** 缩略图项：IntersectionObserver 懒渲染（进入视口附近才交给 pdfjs 渲染小图），渲染过的不再重画 */
function ThumbItem({ doc, page, active, markCount, onJump }: { doc: PDFDocumentProxy; page: number; active: boolean; markCount: number; onJump: (p: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)
  useEffect(() => {
    if (rendered) return
    const canvas = ref.current
    if (!canvas) return
    let alive = true
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        void (async () => {
          try {
            const pg = await doc.getPage(page)
            if (!alive) return
            const vp0 = pg.getViewport({ scale: 1 })
            const vp = pg.getViewport({ scale: 120 / vp0.width })
            canvas.width = Math.floor(vp.width)
            canvas.height = Math.floor(vp.height)
            await pg.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
            if (alive) setRendered(true)
          } catch {
            /* 面板关闭/文档销毁等竞争，忽略 */
          }
        })()
      },
      { rootMargin: '160px' }
    )
    io.observe(canvas)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [doc, page, rendered])
  return (
    <button
      type="button"
      data-pg={page}
      data-pg-current={active ? '' : undefined}
      title={`第 ${page} 页${markCount ? ` · ${markCount} 处标注` : ''}`}
      className={`relative rounded-md border p-1 transition-colors ${active ? 'border-accent bg-accent/10' : 'border-line hover:border-accent'}`}
      onClick={() => onJump(page)}
    >
      {markCount > 0 && (
        <span className="absolute right-1 top-1 rounded-full bg-accent px-1 text-[9px] font-medium leading-3 text-white" title={`${markCount} 处标注`}>
          {markCount > 99 ? '99+' : markCount}
        </span>
      )}
      <canvas ref={ref} className="block w-full bg-white" style={{ aspectRatio: rendered ? undefined : '0.707 / 1' }} />
      <div className="mt-0.5 text-center text-[10px] text-txt-dim">{page}</div>
    </button>
  )
}
