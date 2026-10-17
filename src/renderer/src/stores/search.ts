import { create } from 'zustand'
import { eventBus, EVENTS } from '@/kernel/eventBus'
import { useUi } from '@/stores/ui'
import { usePapers } from '@/stores/papers'
import { useMindmaps } from '@/stores/mindmaps'
import { useSettings } from '@/stores/settings'
import { searchSemanticScholar, type ScholarHit } from '@/lib/scholar'
import { lh } from '@/lib/ipc'
import { truncate } from '@/lib/utils'
import type { MindNode } from '@/types'

export interface Engine {
  id: string
  name: string
  api?: boolean
  url: (q: string) => string
  custom?: boolean
}

/** 内置引擎：Bing 学术（网页）+ Semantic Scholar（开放 API，原生渲染） */
export const BUILTIN_ENGINES: Engine[] = [
  { id: 'bing-academic', name: 'Bing学术', url: (q) => `https://cn.bing.com/academic/search?q=${encodeURIComponent(q)}` },
  { id: 'semanticscholar', name: 'Semantic Scholar', api: true, url: (q) => `https://www.semanticscholar.org/search?q=${encodeURIComponent(q)}` }
]

/** 全部可选引擎 = 内置 + 设置中的自定义引擎（url 含 {q} 占位符） */
export function allEngines(): Engine[] {
  const custom = (useSettings.getState().settings.customEngines ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    url: (q: string) => c.url.replace('{q}', encodeURIComponent(q)),
    custom: true
  }))
  return [...BUILTIN_ENGINES, ...custom]
}

interface SearchState {
  query: string
  engine: string
  src: string
  mapId: string | null
  curId: string | null
  selText: string
  showMap: boolean
  zoomF: number
  results: ScholarHit[] | null
  schLoading: boolean
  schErr: string
  aiBusy: boolean
  wvPreload: string
  set: (patch: Partial<SearchState>) => void
  engOf: (id?: string) => Engine
  /** 执行一次搜索。jumpTo=回跳已有节点（不新建）；asRoot=原文选词的新搜索（并列新根）；默认挂到当前节点下形成下一层 */
  doSearch: (q: string, opts?: { bind?: string; jumpTo?: MindNode; asRoot?: boolean }) => Promise<void>
  /** 在搜索结果里继续搜索 = 对当前解释仍有困惑 → 挂到导图分叉 + 展开成主界面 */
  continueSearch: (q: string) => Promise<void>
  /** 找到答案：选中文本收为答案，折叠到最初搜索内容下方，并自动收回侧边栏 */
  markAnswer: (quote: string, source?: string) => Promise<void>
  /** 从论文笔记的导图/面包屑跳到某一层（打开宽侧栏搜索） */
  openChainNode: (mapId: string, node: MindNode) => Promise<void>
  /** 主界面返回宽侧栏 */
  goBack: () => void
}

export const useSearch = create<SearchState>((set, get) => ({
  query: '',
  engine: 'bing-academic',
  src: '',
  mapId: null,
  curId: null,
  selText: '',
  showMap: true,
  zoomF: 0.75,
  results: null,
  schLoading: false,
  schErr: '',
  aiBusy: false,
  wvPreload: '',

  set: (patch) => set(patch),
  engOf: (id) => allEngines().find((e) => e.id === id) ?? BUILTIN_ENGINES[0],

  doSearch: async (q, opts) => {
    const kw = q.trim()
    if (!kw) return
    const eng = opts?.jumpTo ? get().engOf(opts.jumpTo.provider) : get().engOf(get().engine)
    set({ query: kw, engine: eng.id })
    if (eng.api) {
      set({ src: '', results: null, schErr: '', schLoading: true })
      searchSemanticScholar(kw)
        .then((results) => set({ results }))
        .catch((e) => set({ schErr: (e as Error).message }))
        .finally(() => set({ schLoading: false }))
    } else {
      set({ results: null, src: eng.url(kw) })
    }
    if (opts?.jumpTo) {
      set({ curId: opts.jumpTo.id })
      return
    }
    const ui = useUi.getState()
    const paperId = ui.activePaperId ?? undefined
    const mm = useMindmaps.getState()
    const { mapId, curId } = get()
    const m = mapId ? mm.maps[mapId] : undefined
    if (!m) {
      const created = await mm.create(truncate(kw, 24), paperId, kw)
      mm.updateNode(created.id, created.nodes[0].id, { provider: eng.id, status: 'done' })
      set({ mapId: created.id, curId: created.nodes[0].id })
    } else if (opts?.asRoot) {
      // 原文选词搜索 = 与已有根并列的新根（互不归属）；同标签根查重回跳
      const existRoot = m.nodes.find((n) => n.level === 1 && !n.parentId && n.label === kw)
      if (existRoot) set({ curId: existRoot.id })
      else {
        const added = mm.addNode(m.id, { label: kw.slice(0, 60), level: 1, parentId: null, provider: eng.id, status: 'done' })
        if (added) set({ curId: added.id })
      }
    } else {
      const cur = m.nodes.find((n) => n.id === curId) ?? m.nodes[0]
      const exist = m.nodes.find((n) => n.parentId === cur.id && n.label === kw)
      if (exist) {
        set({ curId: exist.id })
      } else {
        const added = mm.addNode(m.id, {
          label: kw.slice(0, 60),
          level: cur.level + 1,
          parentId: cur.id,
          originText: cur.label,
          provider: eng.id,
          status: 'done'
        })
        if (added) set({ curId: added.id })
      }
    }
    if (paperId && opts?.bind) {
      // 记录归属到当前链路节点（同一节点再搜即覆盖；节点删除时同步清理）
      const { mapId: mid, curId: cid } = get()
      usePapers.getState().addSearch(paperId, { query: kw, provider: eng.id, boundText: opts.bind, mapId: mid ?? undefined, nodeId: cid ?? undefined })
      ui.toast('搜索已与选中片段绑定', 'ok')
    }
  },

  continueSearch: async (q) => {
    const ui = useUi.getState()
    // 无论文上下文时不展开主界面（右侧笔记视图依赖论文），保持侧栏搜索
    if (ui.activePaperId) ui.setSearchStage(2)
    await get().doSearch(q)
  },

  markAnswer: async (quote, source) => {
    const ui = useUi.getState()
    const paperId = ui.activePaperId
    if (!paperId) {
      ui.toast('该搜索未关联论文，无法收为答案', 'error')
      return
    }
    const { mapId, curId, src } = get()
    const m = mapId ? useMindmaps.getState().maps[mapId] : undefined
    if (!m || !curId) {
      ui.toast('没有进行中的搜索链路', 'error')
      return
    }
    // 归属到链路根问题 = 最开始选择并搜索的内容
    let root = m.nodes.find((n) => n.id === curId) ?? m.nodes[0]
    while (root.parentId) root = m.nodes.find((n) => n.id === root.parentId) ?? root
    usePapers.getState().addAnswer(paperId, { mapId: m.id, nodeId: root.id, question: root.label, quote, source: source ?? (src || undefined) })
    // 链路根的原文标记升级为答案色（绿色）：按根问题文本实时匹配；
    // 若该文本从未被标记过，则请求阅读器在原文自动补一个绿色答案标记
    const rootText = root.label
    const norm = (t: string) => t.replace(/\s+/g, '').toLowerCase()
    const pStore = usePapers.getState()
    const matches = pStore.papers[paperId].highlights.filter((h) => norm(h.text) === norm(rootText))
    if (matches.length) {
      for (const h of matches) void pStore.updateHighlight(paperId, h.id, { color: '#37c99e' })
    } else {
      eventBus.emit(EVENTS.markAnswerText, { text: rootText })
    }
    set({ selText: '' })
    ui.toast('已收为答案，折叠到原问题下方', 'ok')
    ui.setSearchStage(0) // 找到答案 → 自动收回侧边栏
  },

  openChainNode: async (mapId, node) => {
    const ui = useUi.getState()
    ui.setSidebarTab('search')
    ui.toggleSidebar(true)
    ui.setSearchStage(1)
    await get().doSearch(node.label, { jumpTo: node })
    set({ mapId })
  },

  goBack: () => useUi.getState().setSearchStage(1)
}))

/** bootstrap 后调用一次：接住「论文选区搜索」与「记录回放」事件 */
export function initSearchEvents(): void {
  eventBus.on('search:open', (payload) => {
    const p = payload as { text: string; paperId?: string }
    const st = useSearch.getState()
    const m = st.mapId ? useMindmaps.getState().maps[st.mapId] : undefined
    // 换了论文 → 开新链路
    if (m && m.paperId && p.paperId && m.paperId !== p.paperId) useSearch.setState({ mapId: null, curId: null })
    const ui = useUi.getState()
    ui.setSidebarTab('search')
    ui.toggleSidebar(true)
    ui.setSearchStage(1) // 第一层搜索：侧边栏向左展开
    void useSearch.getState().doSearch(p.text, { bind: p.text, asRoot: true })
  })
  eventBus.on('search:replay', (payload) => {
    const s = payload as { query: string; provider: string }
    const ui = useUi.getState()
    ui.setSidebarTab('search')
    ui.toggleSidebar(true)
    ui.setSearchStage(Math.max(ui.searchStage, 1) as 0 | 1 | 2)
    const eng = useSearch.getState().engOf(s.provider)
    useSearch.setState({ query: s.query, engine: eng.id, results: null, ...(eng.api ? { src: '' } : { src: eng.url(s.query) }) })
  })
}

/** bootstrap 数据加载后调用一次：清理孤儿搜索记录（旧格式无归属 / 链路或节点已不存在） */
export function pruneSearchHistory(): void {
  const ps = usePapers.getState()
  const maps = useMindmaps.getState().maps
  for (const p of Object.values(ps.papers)) {
    if (p.searches.length === 0) continue
    const keep = p.searches.filter((r) => {
      if (!r.mapId || !r.nodeId) return false // 旧格式：无链路归属，直接清掉
      const m = maps[r.mapId]
      return !!m && m.nodes.some((n) => n.id === r.nodeId)
    })
    if (keep.length !== p.searches.length) void ps.update(p.id, { searches: keep })
  }
}

/** 加载 webview preload 路径（bootstrap 时调用） */
export async function loadSearchAssets(): Promise<void> {
  try {
    const wv = await (lh as unknown as { webviewPreload: () => Promise<string> }).webviewPreload()
    useSearch.setState({ wvPreload: wv })
  } catch {
    /* 忽略：webview 内选中文字上报不可用时仍可手动搜索 */
  }
}
