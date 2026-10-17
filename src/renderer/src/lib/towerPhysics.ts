/** 积木大楼物理内核：纯函数，无 React / store 依赖，可独立推理验证。
 *  坐标系：画布宽 WORLD_W=100，地面 y=0，向上为正。
 *  模型：房顶是固定中心的大重量刚体，向下施力；载荷沿接触面按重叠长度比例
 *  向下分配；任一刚体（含房顶）的累积载荷质心滑出其支撑并集 → 倾覆。
 *  这套简化模型天然阻止作弊：细长形状若只有一端被支撑，质心必然出界。 */

export const WORLD_W = 100
export const CELL = 2.5 // 形状格子边长（画布单位）
export const GRID = 8 // 自画形状网格 8x8
/** 房顶参数：中心固定在画布中央，宽而重，确保楼必须往中间盖才接得住 */
export const ROOF = { cx: 50, w: 26, h: 6 }

export interface Body {
  id: string
  x: number // 中心 x
  y: number // 底部高度
  w: number
  h: number
}

/** 由 8x8 格子集合（0-63 下标）求包围盒尺寸 */
export function bboxOfCells(cells: number[]): { w: number; h: number } {
  let minC = GRID
  let maxC = -1
  let minR = GRID
  let maxR = -1
  for (const c of cells) {
    const col = c % GRID
    const row = Math.floor(c / GRID)
    if (col < minC) minC = col
    if (col > maxC) maxC = col
    if (row < minR) minR = row
    if (row > maxR) maxR = row
  }
  if (maxC < 0) return { w: CELL, h: CELL }
  return { w: (maxC - minC + 1) * CELL, h: (maxR - minR + 1) * CELL }
}

const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1)

/** 垂直下落：返回底部贴合支撑面（地面或下方块顶）的 y */
export function dropY(blocks: Body[], cx: number, w: number): number {
  const l = cx - w / 2
  const r = cx + w / 2
  let top = 0
  for (const b of blocks) {
    if (overlap(l, r, b.x - b.w / 2, b.x + b.w / 2) > 0.1) top = Math.max(top, b.y + b.h)
  }
  return top
}

interface Load {
  mass: number
  mx: number // mass * cx 累计
}

interface CheckResult {
  stable: boolean
  /** 失稳刚体 id 集合；房顶 id 固定为 'roof'。stable 时为空集 */
  falling: Set<string>
}

/** 稳定性检查：blocks 为已放置块（y 已由 dropY 确定）。 */
export function checkStability(blocks: Body[]): CheckResult {
  const falling = new Set<string>()
  if (!blocks.length) return { stable: true, falling }

  // 载荷登记：id → 累计 (mass, mass*cx)。房顶载荷从这里开始向下传播。
  const loads = new Map<string, Load>()
  const give = (toId: string, mass: number, cx: number) => {
    const cur = loads.get(toId) ?? { mass: 0, mx: 0 }
    cur.mass += mass
    cur.mx += mass * cx
    loads.set(toId, cur)
  }

  /** 把载荷 (mass, cx) 沿支撑块分配；返回 null 表示由地面承接（无限宽，稳） */
  const distribute = (self: Body, mass: number, cx: number): boolean => {
    const l = self.x - self.w / 2
    const r = self.x + self.w / 2
    const contacts = blocks
      .filter((b) => b.y + b.h < self.y + 0.2 && b.y + b.h > self.y - 0.2)
      .map((b) => ({ b, ov: overlap(l, r, b.x - b.w / 2, b.x + b.w / 2) }))
      .filter((c) => c.ov > 0.1)
    if (!contacts.length) return true // 地面
    const sum = contacts.reduce((s, c) => s + c.ov, 0)
    for (const c of contacts) give(c.b.id, (mass * c.ov) / sum, cx)
    return false
  }

  /** 支撑并集 [L, R]；空数组表示地面 */
  const supportSpan = (self: Body): [number, number] | null => {
    const l = self.x - self.w / 2
    const r = self.x + self.w / 2
    let L = Infinity
    let R = -Infinity
    for (const b of blocks) {
      if (b.y + b.h < self.y + 0.2 && b.y + b.h > self.y - 0.2 && overlap(l, r, b.x - b.w / 2, b.x + b.w / 2) > 0.1) {
        L = Math.min(L, Math.max(l, b.x - b.w / 2))
        R = Math.max(R, Math.min(r, b.x + b.w / 2))
      }
    }
    return L === Infinity ? null : [L, R]
  }

  const EPS = 0.3

  // 1) 房顶：中心固定施力；没有任何块接住它（落到地面）或质心出支撑并集 → 掉落
  const roofSpan = supportSpan({ id: 'roof', x: ROOF.cx, y: dropY(blocks, ROOF.cx, ROOF.w), w: ROOF.w, h: ROOF.h })
  if (!roofSpan || ROOF.cx < roofSpan[0] + EPS || ROOF.cx > roofSpan[1] - EPS) {
    falling.add('roof')
    return { stable: false, falling }
  }

  // 2) 块自上而下：检查「上方载荷 + 自重」合成质心是否在支撑并集内，稳定则向下分配
  const ordered = [...blocks].sort((a, b) => b.y - a.y)
  for (const b of ordered) {
    const selfMass = b.w * b.h
    const incoming = loads.get(b.id) ?? { mass: 0, mx: 0 }
    const total = incoming.mass + selfMass
    const cx = total > 0 ? (incoming.mx + selfMass * b.x) / total : b.x
    const span = supportSpan(b)
    if (span && (cx < span[0] + EPS || cx > span[1] - EPS)) {
      // 该块倾覆：自身 + 其上所有块 + 房顶一起掉
      falling.add(b.id)
      for (const o of ordered) if (o.y > b.y - 0.001) falling.add(o.id)
      falling.add('roof')
      return { stable: false, falling }
    }
    if (!distribute(b, total, cx)) continue // 地面承接，链路结束
  }
  return { stable: true, falling }
}

/** 楼顶高度（已放置块的最高顶部；空楼为 0） */
export function topHeight(blocks: Body[]): number {
  return blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0)
}
