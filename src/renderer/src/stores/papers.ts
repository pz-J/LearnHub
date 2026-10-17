import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { eventBus } from '@/kernel/eventBus'
import type { Highlight, Paper, PaperAnswer, SearchRecord } from '@/types'

const DIR = 'papers'

/** 文本归一化（去空白 + 小写），用于判断两处标记是否为同一内容 */
function normText(t: string): string {
  return t.replace(/\s+/g, '').toLowerCase()
}

interface PapersState {
  papers: Record<string, Paper>
  order: string[]
  loaded: boolean
  load: () => Promise<void>
  add: (p: { fileName: string; title?: string; id: string }) => Promise<Paper>
  update: (id: string, patch: Partial<Paper>) => Promise<void>
  remove: (id: string) => Promise<void>
  addHighlight: (paperId: string, h: Omit<Highlight, 'id' | 'createdAt'>) => Highlight | null
  updateHighlight: (paperId: string, hid: string, patch: Partial<Highlight>) => Promise<void>
  removeHighlight: (paperId: string, hid: string) => Promise<void>
  addSearch: (paperId: string, s: Omit<SearchRecord, 'id' | 'createdAt'>) => SearchRecord | null
  /** 清理搜索记录：删除指定链路中被移除节点（含子树）的记录，避免残留过时历史 */
  removeSearches: (mapId: string, nodeIds: string[]) => Promise<void>
  addAnswer: (paperId: string, a: Omit<PaperAnswer, 'id' | 'createdAt'>) => PaperAnswer | null
  removeAnswer: (paperId: string, aid: string) => Promise<void>
  updateAnswer: (paperId: string, aid: string, patch: { quote?: string }) => Promise<void>
  get: (id: string) => Paper | undefined
}

async function persist(paper: Paper): Promise<void> {
  paper.updatedAt = Date.now()
  await lh.dataWrite(`${DIR}/${paper.id}.json`, paper)
}

export const usePapers = create<PapersState>((set, get) => ({
  papers: {},
  order: [],
  loaded: false,
  load: async () => {
    const files = await lh.dataList(DIR)
    const papers: Record<string, Paper> = {}
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const p = (await lh.dataRead(`${DIR}/${f}`)) as Paper | null
      if (p?.id) papers[p.id] = p
    }
    const order = Object.values(papers)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => p.id)
    set({ papers, order, loaded: true })
  },
  add: async ({ fileName, title, id }) => {
    const now = Date.now()
    const paper: Paper = {
      id,
      title: title ?? fileName.replace(/\.pdf$/i, ''),
      fileName,
      tags: [],
      course: '',
      meta: { doi: '', authors: '', year: '', venue: '' },
      highlights: [],
      searches: [],
      createdAt: now,
      updatedAt: now
    }
    set({ papers: { ...get().papers, [id]: paper }, order: [id, ...get().order] })
    await persist(paper)
    return paper
  },
  update: async (id, patch) => {
    const p = get().papers[id]
    if (!p) return
    const next = { ...p, ...patch, updatedAt: Date.now() }
    set({ papers: { ...get().papers, [id]: next } })
    await persist(next)
  },
  remove: async (id) => {
    await lh.dataDelete(`${DIR}/${id}.json`)
    await lh.pdfDelete(id)
    const papers = { ...get().papers }
    delete papers[id]
    set({ papers, order: get().order.filter((x) => x !== id) })
  },
  addHighlight: (paperId, h) => {
    const p = get().papers[paperId]
    if (!p) return null
    const hl: Highlight = { ...h, id: uid('h_'), createdAt: Date.now() }
    // 同文本已有标记 → 自动继承其解释，用户无需重复标记
    const norm = normText(h.text)
    const same = p.highlights.find((x) => normText(x.text) === norm)
    if (same) {
      if (same.note) hl.note = same.note
      if (same.aiExplain) hl.aiExplain = same.aiExplain
    }
    const next = { ...p, highlights: [...p.highlights, hl], updatedAt: Date.now() }
    set({ papers: { ...get().papers, [paperId]: next } })
    void lh.dataWrite(`${DIR}/${paperId}.json`, next)
    eventBus.emit('reader:highlight-added', { paperId, highlight: hl })
    return hl
  },
  updateHighlight: async (paperId, hid, patch) => {
    const p = get().papers[paperId]
    if (!p) return
    const target = p.highlights.find((h) => h.id === hid)
    if (!target) return
    // 同文本标记的解释一处更新、处处同步
    const norm = normText(target.text)
    const syncExplain = 'note' in patch || 'aiExplain' in patch
    const next = {
      ...p,
      highlights: p.highlights.map((h) => {
        if (h.id === hid) return { ...h, ...patch }
        if (syncExplain && normText(h.text) === norm) {
          return {
            ...h,
            note: 'note' in patch ? patch.note : h.note,
            aiExplain: 'aiExplain' in patch ? patch.aiExplain : h.aiExplain
          }
        }
        return h
      }),
      updatedAt: Date.now()
    }
    set({ papers: { ...get().papers, [paperId]: next } })
    await lh.dataWrite(`${DIR}/${paperId}.json`, next)
  },
  removeHighlight: async (paperId, hid) => {
    const p = get().papers[paperId]
    if (!p) return
    const next = { ...p, highlights: p.highlights.filter((h) => h.id !== hid), updatedAt: Date.now() }
    set({ papers: { ...get().papers, [paperId]: next } })
    await lh.dataWrite(`${DIR}/${paperId}.json`, next)
    eventBus.emit('reader:highlight-removed', { paperId, highlightId: hid })
  },
  addSearch: (paperId, s) => {
    const p = get().papers[paperId]
    if (!p) return null
    // 同一链路节点重复搜索（修改关键词/回放）→ 覆盖旧记录，不留下修改前的历史
    const rest = p.searches.filter((r) => !(s.mapId && s.nodeId && r.mapId === s.mapId && r.nodeId === s.nodeId))
    const rec: SearchRecord = { ...s, id: uid('s_'), createdAt: Date.now() }
    const next = { ...p, searches: [...rest, rec], updatedAt: Date.now() }
    set({ papers: { ...get().papers, [paperId]: next } })
    void lh.dataWrite(`${DIR}/${paperId}.json`, next)
    return rec
  },
  removeSearches: async (mapId, nodeIds) => {
    const doomed = new Set(nodeIds)
    for (const p of Object.values(get().papers)) {
      const keep = p.searches.filter((r) => !(r.mapId === mapId && r.nodeId && doomed.has(r.nodeId)))
      if (keep.length !== p.searches.length) await get().update(p.id, { searches: keep })
    }
  },
  addAnswer: (paperId, a) => {
    const p = get().papers[paperId]
    if (!p) return null
    const ans: PaperAnswer = { ...a, id: uid('a_'), createdAt: Date.now() }
    const next = { ...p, answers: [...(p.answers ?? []), ans], updatedAt: Date.now() }
    set({ papers: { ...get().papers, [paperId]: next } })
    void lh.dataWrite(`${DIR}/${paperId}.json`, next)
    return ans
  },
  removeAnswer: async (paperId, aid) => {
    const p = get().papers[paperId]
    if (!p) return
    const next = { ...p, answers: (p.answers ?? []).filter((x) => x.id !== aid), updatedAt: Date.now() }
    set({ papers: { ...get().papers, [paperId]: next } })
    await lh.dataWrite(`${DIR}/${paperId}.json`, next)
  },
  updateAnswer: async (paperId, aid, patch) => {
    const p = get().papers[paperId]
    if (!p) return
    const next = { ...p, answers: (p.answers ?? []).map((x) => (x.id === aid ? { ...x, ...patch } : x)), updatedAt: Date.now() }
    set({ papers: { ...get().papers, [paperId]: next } })
    await lh.dataWrite(`${DIR}/${paperId}.json`, next)
  },
  get: (id) => get().papers[id]
}))
