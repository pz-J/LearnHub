import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { WORLD_W, bboxOfCells, checkStability, dropY, topHeight, type Body } from '@/lib/towerPhysics'

const FILE = 'tower.json'

/** 积木调色板（末位金色为作弊码专属） */
export const BLOCK_COLORS = ['#5b8cff', '#37c99e', '#f5a623', '#e57373', '#9d6bff', '#64b5f6', '#f0c419']
export const GOLD_COLOR = 6

/** 形状：cells 为 8x8 网格被占用的格子下标（row*8+col），物理取包围盒 */
export interface ShapeDef {
  id: string
  name: string
  cells: number[]
  preset: boolean
}

export interface InvItem {
  id: string
  shapeId: string
  color: number
}

export interface PlacedItem {
  id: string
  shapeId: string
  color: number
  x: number // 中心 x；y 由物理落点决定，不入库（重算即得）
}

export interface LevelDef {
  id: string
  name: string
  desc: string
  /** 解锁所需的楼顶高度（画布单位） */
  unlockAt: number
}

export const LEVELS: LevelDef[] = [
  { id: 'alps', name: '阿尔卑斯草地', desc: '雪山脚下的草地与木屋', unlockAt: 0 },
  { id: 'desert', name: '沙漠金字塔', desc: '风滚草滚过的砂岩之地', unlockAt: 60 },
  { id: 'sakura', name: '樱花庭院', desc: '瓦檐飘落粉色春天', unlockAt: 120 },
  { id: 'night', name: '星夜灯塔', desc: '深夜海崖上的一盏灯', unlockAt: 200 }
]

const mk = (c0: number, r0: number, w: number, h: number): number[] => {
  const out: number[] = []
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) out.push(r * 8 + c)
  return out
}

/** 预设形状（代码即真相，不入持久化） */
export const PRESET_SHAPES: ShapeDef[] = [
  { id: 'sh-box', name: '方块', cells: mk(2, 2, 4, 3), preset: true },
  { id: 'sh-plank', name: '长板', cells: mk(1, 3, 6, 2), preset: true },
  { id: 'sh-pillar', name: '立柱', cells: mk(3, 1, 2, 6), preset: true },
  { id: 'sh-wedge', name: '楔形', cells: [...mk(3, 2, 2, 1), ...mk(2, 3, 4, 1), ...mk(1, 4, 6, 1)], preset: true },
  { id: 'sh-el', name: 'L 形', cells: [...mk(2, 2, 2, 3), ...mk(4, 4, 2, 1)], preset: true },
  { id: 'sh-drum', name: '圆鼓', cells: mk(2, 2, 4, 4), preset: true },
  { id: 'sh-beam', name: '工字梁', cells: [...mk(1, 2, 6, 1), ...mk(3, 3, 2, 1), ...mk(1, 4, 6, 1)], preset: true }
]

interface PersistShape {
  shapes: ShapeDef[] // 仅自画形状
  inventory: InvItem[]
  placed: PlacedItem[]
  maxTop: number
  /** 历史最高连击（旧数据缺省按 0 处理） */
  maxCombo?: number
  levelId: string
  updatedAt: number
}

export interface PlaceResult {
  ok: boolean
  /** 房顶掉落并已回退 */
  fell: boolean
}

interface TowerState {
  shapes: ShapeDef[]
  inventory: InvItem[]
  placed: PlacedItem[]
  maxTop: number
  /** 历史最高连击（连续成功放置，塌落/撤回中断） */
  maxCombo: number
  levelId: string
  loaded: boolean
  load: () => Promise<void>
  /** 当前已解锁的关卡下标（由历史最高高度决定，单调不回退） */
  unlockedCount: () => number
  addCustomShape: (name: string, cells: number[]) => Promise<ShapeDef>
  removeCustomShape: (id: string) => Promise<void>
  /** 成就领取/作弊码 → 积木入库存 */
  grant: (shapeId: string, color: number) => Promise<void>
  /** 从库存放置到画布；结构失稳时自动回退最后一块 */
  place: (invId: string, x: number) => Promise<PlaceResult>
  /** 撤回最后一块回库存 */
  withdrawLast: () => Promise<void>
  /** 更新历史最高连击（只增不减） */
  setMaxCombo: (n: number) => Promise<void>
  /** 作弊码：奖励一块金色测试积木（随机预设形状） */
  konami: () => Promise<void>
  switchLevel: (id: string) => Promise<void>
}

async function persist(s: Omit<PersistShape, 'updatedAt'>): Promise<void> {
  await lh.dataWrite(FILE, { ...s, updatedAt: Date.now() } satisfies PersistShape)
}

const snapshot = (s: TowerState): Omit<PersistShape, 'updatedAt'> => ({
  shapes: s.shapes.filter((x) => !x.preset),
  inventory: s.inventory,
  placed: s.placed,
  maxTop: s.maxTop,
  maxCombo: s.maxCombo,
  levelId: s.levelId
})

export const useTower = create<TowerState>((set, get) => ({
  shapes: PRESET_SHAPES,
  inventory: [],
  placed: [],
  maxTop: 0,
  maxCombo: 0,
  levelId: 'alps',
  loaded: false,
  load: async () => {
    const data = (await lh.dataRead(FILE)) as PersistShape | null
    const customs = (data?.shapes ?? []).filter((s) => Array.isArray(s.cells) && s.cells.length > 0)
    // 旧版成就大楼的 blocks 数据迁移为库存块（形状映射到预设矩形）
    const legacy = (data as unknown as { blocks?: { shape: number; color: number }[] } | null)?.blocks
    const migrated: InvItem[] = (legacy ?? []).map((b) => ({
      id: uid('inv_'),
      shapeId: PRESET_SHAPES[Math.max(0, Math.min(PRESET_SHAPES.length - 1, b.shape % PRESET_SHAPES.length))].id,
      color: Math.max(0, Math.min(BLOCK_COLORS.length - 1, b.color % BLOCK_COLORS.length))
    }))
    set({
      shapes: [...PRESET_SHAPES, ...customs],
      inventory: [...(data?.inventory ?? []), ...migrated],
      placed: data?.placed ?? [],
      maxTop: data?.maxTop ?? 0,
      maxCombo: data?.maxCombo ?? 0,
      levelId: LEVELS.some((l) => l.id === data?.levelId) ? data!.levelId : 'alps',
      loaded: true
    })
  },
  unlockedCount: () => {
    let n = 0
    for (const l of LEVELS) if (get().maxTop >= l.unlockAt) n += 1
    return n
  },
  addCustomShape: async (name, cells) => {
    const shape: ShapeDef = { id: uid('sh_'), name: name.trim().slice(0, 12) || '自画形状', cells, preset: false }
    const next = { ...snapshot(get()), shapes: [...get().shapes.filter((x) => !x.preset), shape] }
    set({ shapes: [...PRESET_SHAPES, ...next.shapes] })
    await persist(next)
    return shape
  },
  removeCustomShape: async (id) => {
    const s = get()
    if (s.placed.some((p) => p.shapeId === id)) return // 已上楼的形状不可删
    const next = { ...snapshot(s), shapes: s.shapes.filter((x) => !x.preset && x.id !== id), inventory: s.inventory.filter((i) => i.shapeId !== id) }
    set({ shapes: [...PRESET_SHAPES, ...next.shapes], inventory: next.inventory })
    await persist(next)
  },
  grant: async (shapeId, color) => {
    const s = get()
    if (!s.shapes.some((x) => x.id === shapeId)) throw new Error('所选积木形状已不存在，请重新选择')
    const item: InvItem = { id: uid('inv_'), shapeId, color: Math.max(0, Math.min(BLOCK_COLORS.length - 1, color)) }
    const next = { ...snapshot(s), inventory: [...s.inventory, item] }
    set({ inventory: next.inventory })
    try {
      await persist(next)
    } catch (error) {
      // Do not leave a phantom reward in memory when durable storage rejects the write.
      // Remove only this grant: restoring the whole snapshot could erase a concurrent reward.
      set({ inventory: get().inventory.filter((entry) => entry.id !== item.id) })
      throw error
    }
  },
  place: async (invId, x) => {
    const s = get()
    const item = s.inventory.find((i) => i.id === invId)
    if (!item) return { ok: false, fell: false }
    const shape = s.shapes.find((x2) => x2.id === item.shapeId)
    if (!shape) return { ok: false, fell: false }
    const bb = bboxOfCells(shape.cells)
    // 由放置顺序线性重算每块落点（y 不入库，重算即得）
    const rebuilt: Body[] = []
    for (const p of s.placed) {
      const pb = bboxOfCells(s.shapes.find((x2) => x2.id === p.shapeId)!.cells)
      rebuilt.push({ id: p.id, x: p.x, y: dropY(rebuilt, p.x, pb.w), w: pb.w, h: pb.h })
    }
    const cx = Math.max(bb.w / 2, Math.min(WORLD_W - bb.w / 2, x))
    const nb: Body = { id: item.id, x: cx, y: dropY(rebuilt, cx, bb.w), w: bb.w, h: bb.h }
    const check = checkStability([...rebuilt, nb])
    if (!check.stable) return { ok: false, fell: true } // 房顶/结构倾覆：拒绝放置并回退
    const nextPlaced: PlacedItem[] = [...s.placed, { id: item.id, shapeId: item.shapeId, color: item.color, x: cx }]
    const nextInv = s.inventory.filter((i) => i.id !== invId)
    const maxTop = Math.max(s.maxTop, topHeight([...rebuilt, nb]))
    set({ placed: nextPlaced, inventory: nextInv, maxTop })
    await persist(snapshot({ ...s, placed: nextPlaced, inventory: nextInv, maxTop }))
    return { ok: true, fell: false }
  },
  withdrawLast: async () => {
    const s = get()
    const last = s.placed[s.placed.length - 1]
    if (!last) return
    const nextPlaced = s.placed.slice(0, -1)
    const nextInv = [...s.inventory, { id: last.id, shapeId: last.shapeId, color: last.color }]
    const next = { ...snapshot(s), placed: nextPlaced, inventory: nextInv }
    set({ placed: nextPlaced, inventory: nextInv })
    await persist(next)
  },
  setMaxCombo: async (n) => {
    const s = get()
    if (n <= s.maxCombo) return // 只增不减
    set({ maxCombo: n })
    await persist(snapshot(get()))
  },
  konami: async () => {
    const shape = PRESET_SHAPES[Math.floor(Math.random() * PRESET_SHAPES.length)]
    await get().grant(shape.id, GOLD_COLOR)
  },
  switchLevel: async (id) => {
    const s = get()
    if (!LEVELS.some((l) => l.id === id)) return
    set({ levelId: id })
    await persist(snapshot({ ...s, levelId: id }))
  }
}))
