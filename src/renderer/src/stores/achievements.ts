import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { usePapers } from './papers'
import { useTodos } from './todos'
import { useFocus } from './misc'
import { useMindmaps } from './mindmaps'
import { useNotes } from './notes'
import { useTower, PRESET_SHAPES, BLOCK_COLORS } from './tower'

const FILE = 'achievements.json'

/** 成就计量维度（全部从现有 store 实时统计，不重复记账） */
export type Metric = 'papers' | 'papers-finished' | 'marks' | 'notes' | 'focus-min' | 'todos' | 'chain' | 'tower-top' | 'tower-combo'

export interface AchievementDef {
  id: string
  title: string
  desc: string
  metric: Metric
  target: number
}

/** 内置成就定义（不可变，进度达标即可领积木） */
export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'a-paper-1', title: '初窥门径', desc: '文献库导入第一篇论文', metric: 'papers', target: 1 },
  { id: 'a-paper-5', title: '书山有路', desc: '文献库累计 5 篇论文', metric: 'papers', target: 5 },
  { id: 'a-finish-1', title: '卒读', desc: '完整读完第一篇论文', metric: 'papers-finished', target: 1 },
  { id: 'a-finish-5', title: '博览群书', desc: '累计读完 5 篇论文', metric: 'papers-finished', target: 5 },
  { id: 'a-marks-10', title: '勾勾画画', desc: '累计做出 10 处标记', metric: 'marks', target: 10 },
  { id: 'a-marks-50', title: '批注如林', desc: '累计做出 50 处标记', metric: 'marks', target: 50 },
  { id: 'a-focus-60', title: '一小时定力', desc: '累计专注 60 分钟', metric: 'focus-min', target: 60 },
  { id: 'a-focus-300', title: '深度工作', desc: '累计专注 300 分钟', metric: 'focus-min', target: 300 },
  { id: 'a-todos-10', title: '言出必行', desc: '完成 10 个待办', metric: 'todos', target: 10 },
  { id: 'a-chain-20', title: '链路成网', desc: '思维链路累计 20 个节点', metric: 'chain', target: 20 },
  { id: 'a-notes-5', title: '笔耕不辍', desc: '累计写下 5 篇笔记', metric: 'notes', target: 5 },
  { id: 'a-tower-50', title: '摩天大楼', desc: '成就大楼历史最高楼高达到 50', metric: 'tower-top', target: 50 },
  { id: 'a-combo-10', title: '十连巧匠', desc: '连续成功放置 10 块积木不塌落', metric: 'tower-combo', target: 10 }
]

export interface CustomTask {
  id: string
  title: string
  done: boolean
  claimed: boolean
  createdAt: number
  doneAt?: number
}

/** 外部模块经 achievements.award 登记的任务（每条未领取的可换一块积木） */
export interface ModuleTask {
  id: string
  moduleId: string
  taskId: string
  title: string
  claimed: boolean
  at: number
}

interface PersistShape {
  claimedIds: string[]
  customTasks: CustomTask[]
  moduleTasks: ModuleTask[]
  updatedAt: number
}

interface AchievementsState {
  claimedIds: string[]
  customTasks: CustomTask[]
  moduleTasks: ModuleTask[]
  loaded: boolean
  load: () => Promise<void>
  /** 各指标当前进度（实时计算） */
  progress: () => Record<Metric, number>
  /** 领取内置成就：登记已领 + 积木（选定的形状与颜色）入库存 */
  claim: (defId: string, shapeId: string, color: number) => Promise<void>
  /** 领取自定义/模块任务奖励积木 */
  claimTask: (taskId: string, shapeId: string, color: number) => Promise<void>
  addCustomTask: (title: string) => Promise<void>
  toggleCustomTask: (id: string) => Promise<void>
  removeCustomTask: (id: string) => Promise<void>
  /** 外部模块登记任务；同一 taskId 存在未领取记录时返回 false（防止刷积木） */
  addModuleTask: (moduleId: string, taskId: string, title: string) => boolean
  togglePaperFinished: (paperId: string) => Promise<void>
}

async function persist(s: Omit<PersistShape, 'updatedAt'>): Promise<void> {
  await lh.dataWrite(FILE, { ...s, updatedAt: Date.now() } satisfies PersistShape)
}

export const useAchievements = create<AchievementsState>((set, get) => ({
  claimedIds: [],
  customTasks: [],
  moduleTasks: [],
  loaded: false,
  load: async () => {
    const data = (await lh.dataRead(FILE)) as (PersistShape & { blocks?: { shape: number; color: number }[] }) | null
    set({
      claimedIds: data?.claimedIds ?? [],
      customTasks: data?.customTasks ?? [],
      moduleTasks: data?.moduleTasks ?? [],
      loaded: true
    })
    // 旧版自动堆顶的 blocks 迁移为库存块（成就必须先加载 tower 再走这里）
    if (data?.blocks?.length) {
      for (const b of data.blocks) {
        const shapeId = PRESET_SHAPES[Math.max(0, Math.min(PRESET_SHAPES.length - 1, b.shape % PRESET_SHAPES.length))].id
        await useTower.getState().grant(shapeId, Math.max(0, Math.min(BLOCK_COLORS.length - 1, b.color % BLOCK_COLORS.length)))
      }
      await persist({ claimedIds: get().claimedIds, customTasks: get().customTasks, moduleTasks: get().moduleTasks })
    }
  },
  progress: () => {
    const papers = Object.values(usePapers.getState().papers)
    return {
      papers: papers.length,
      'papers-finished': papers.filter((p) => p.finished).length,
      marks: papers.reduce((n, p) => n + p.highlights.length, 0),
      notes: Object.keys(useNotes.getState().notes).length,
      'focus-min': useFocus.getState().sessions.reduce((n, s) => n + (s.minutes || 0), 0),
      todos: useTodos.getState().items.filter((t) => t.done).length,
      chain: Object.values(useMindmaps.getState().maps).reduce((n, m) => n + m.nodes.length, 0),
      'tower-top': useTower.getState().maxTop,
      'tower-combo': useTower.getState().maxCombo
    }
  },
  claim: async (defId, shapeId, color) => {
    const s = get()
    if (s.claimedIds.includes(defId)) return
    const next = { claimedIds: [...s.claimedIds, defId], customTasks: s.customTasks, moduleTasks: s.moduleTasks }
    set(next)
    await persist(next)
    await useTower.getState().grant(shapeId, color)
  },
  claimTask: async (taskId, shapeId, color) => {
    const s = get()
    const custom = s.customTasks.find((t) => t.id === taskId && t.done && !t.claimed)
    const module_ = s.moduleTasks.find((t) => t.id === taskId && !t.claimed)
    if (!custom && !module_) return
    const next = {
      claimedIds: s.claimedIds,
      customTasks: custom ? s.customTasks.map((t) => (t.id === taskId ? { ...t, claimed: true } : t)) : s.customTasks,
      moduleTasks: module_ ? s.moduleTasks.map((t) => (t.id === taskId ? { ...t, claimed: true } : t)) : s.moduleTasks
    }
    set(next)
    await persist(next)
    await useTower.getState().grant(shapeId, color)
  },
  addCustomTask: async (title) => {
    const s = get()
    const task: CustomTask = { id: uid('ct_'), title: title.trim().slice(0, 60) || '自定义任务', done: false, claimed: false, createdAt: Date.now() }
    const next = { claimedIds: s.claimedIds, customTasks: [...s.customTasks, task], moduleTasks: s.moduleTasks }
    set(next)
    await persist(next)
  },
  toggleCustomTask: async (id) => {
    const s = get()
    const next = {
      claimedIds: s.claimedIds,
      customTasks: s.customTasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : undefined } : t)),
      moduleTasks: s.moduleTasks
    }
    set(next)
    await persist(next)
  },
  removeCustomTask: async (id) => {
    const s = get()
    const next = { claimedIds: s.claimedIds, customTasks: s.customTasks.filter((t) => t.id !== id), moduleTasks: s.moduleTasks }
    set(next)
    await persist(next)
  },
  addModuleTask: (moduleId, taskId, title) => {
    const s = get()
    if (s.moduleTasks.some((t) => t.moduleId === moduleId && t.taskId === taskId && !t.claimed)) return false
    const entry: ModuleTask = { id: uid('mt_'), moduleId, taskId, title: title.slice(0, 80), claimed: false, at: Date.now() }
    // 克制存储：最多保留 100 条任务记录，丢弃最早的已领取记录
    const kept = [...s.moduleTasks, entry]
    while (kept.length > 100) {
      const idx = kept.findIndex((t) => t.claimed)
      if (idx < 0) break
      kept.splice(idx, 1)
    }
    const next = { claimedIds: s.claimedIds, customTasks: s.customTasks, moduleTasks: kept }
    set(next)
    void persist(next)
    return true
  },
  togglePaperFinished: async (paperId) => {
    const cur = usePapers.getState().papers[paperId]
    if (!cur) return
    await usePapers.getState().update(paperId, { finished: !cur.finished })
  }
}))
