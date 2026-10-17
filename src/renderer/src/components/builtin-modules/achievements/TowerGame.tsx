import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as RDragEvent, MouseEvent as RMouseEvent } from 'react'
import { CELL, GRID, ROOF, bboxOfCells, dropY, topHeight, type Body } from '@/lib/towerPhysics'
import { BLOCK_COLORS, LEVELS, useTower } from '@/stores/tower'
import { useUi } from '@/stores/ui'
import { CellsSvg, cellsBounds } from './ShapeDrawer'
import { LevelBackdrop, LevelProps, LevelRoof, SCENE_PROPS } from './LevelScenes'

const chipBtn =
  'inline-flex items-center justify-center rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50'

/** 相机：zoom ∈ [0.6, 3]；pan 为相对「自动跟随中心」的世界偏移。
 *  自动中心 = (50, -viewTop-30)，viewTop 仍随楼高自动抬升，缩放/平移在其之上叠加。 */
const ZOOM_MIN = 0.6
const ZOOM_MAX = 3
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const clampPan = (x: number, y: number) => ({ x: clamp(x, -60, 60), y: clamp(y, -220, 40) })

/** 积木画布：世界宽 100，y 向上；绘制时 y_svg = -(世界y)。 */
export function TowerGame({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const shapes = useTower((s) => s.shapes)
  const inventory = useTower((s) => s.inventory)
  const placed = useTower((s) => s.placed)
  const maxTop = useTower((s) => s.maxTop)
  const levelId = useTower((s) => s.levelId)
  const unlocked = useTower((s) => s.unlockedCount())
  const place = useTower((s) => s.place)
  const withdrawLast = useTower((s) => s.withdrawLast)
  const removeCustomShape = useTower((s) => s.removeCustomShape)
  const switchLevel = useTower((s) => s.switchLevel)

  const [selectedInv, setSelectedInv] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [bounceKey, setBounceKey] = useState(0)
  const [recordFlash, setRecordFlash] = useState(false)
  const [combo, setCombo] = useState(0)
  // 放置模式下的落点虚影：鼠标移动时实时预览该积木将落到的位置
  const [ghost, setGhost] = useState<{ x: number; w: number; h: number } | null>(null)
  const [banner, setBanner] = useState<{ title: string; sub: string; key: number } | null>(null)
  // 破纪录放置时在楼顶弹出的增量浮动数字（+N，上浮淡出）
  const [gain, setGain] = useState<{ id: number; h: number } | null>(null)
  const draggingRef = useRef<string | null>(null)
  const shakeTimer = useRef<number | undefined>(undefined)
  const bannerTimer = useRef<number | undefined>(undefined)
  const flashTimer = useRef<number | undefined>(undefined)
  const gainTimer = useRef<number | undefined>(undefined)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const panDrag = useRef<{ sx: number; sy: number; px: number; py: number; scale: number } | null>(null)

  // 与 store.place 相同的算法：按放置顺序重建 bodies（y 不入库，重算即得）
  const bodies = useMemo<Body[]>(() => {
    const rebuilt: Body[] = []
    for (const p of placed) {
      const shape = shapes.find((s) => s.id === p.shapeId)
      const bb = shape ? bboxOfCells(shape.cells) : { w: CELL, h: CELL }
      rebuilt.push({ id: p.id, x: p.x, y: dropY(rebuilt, p.x, bb.w), w: bb.w, h: bb.h })
    }
    return rebuilt
  }, [placed, shapes])

  const bodyById = useMemo(() => new Map(bodies.map((b) => [b.id, b])), [bodies])
  const topH = topHeight(bodies)
  const viewTop = Math.max(0, topH - 52)
  const roofY = dropY(bodies, ROOF.cx, ROOF.w)
  const level = LEVELS.find((l) => l.id === levelId) ?? LEVELS[0]
  const nextLevel = LEVELS[unlocked]
  const beamAt = SCENE_PROPS.night.find((p) => p.id === 'beam')?.unlockAt ?? 90
  const lastPlacedId = placed.length ? placed[placed.length - 1].id : null

  // 相机派生量
  const vbW = 100 / zoom
  const vbH = 68 / zoom
  const vbX = 50 + pan.x - vbW / 2
  const vbY = -viewTop - 30 + pan.y - vbH / 2

  // 供原生 wheel 监听读取最新相机状态
  const camRef = useRef({ zoom, pan, viewTop })
  camRef.current = { zoom, pan, viewTop }

  // 待解锁目标虚线刻度（关卡 + 当前关卡场景装饰）：只画尚未解锁且在可视区内的高度，
  // 标注「再高 N」，让下一份奖励始终可见（随缩放/平移自然跟随）
  const guides = useMemo(() => {
    const items: { y: number; label: string }[] = []
    for (const l of LEVELS) if (l.unlockAt > maxTop) items.push({ y: l.unlockAt, label: `${l.name} · ${l.unlockAt}` })
    for (const p of SCENE_PROPS[level.id] ?? []) if (p.unlockAt > maxTop) items.push({ y: p.unlockAt, label: `${p.name} · ${p.unlockAt}` })
    return items
      .sort((a, b) => a.y - b.y)
      .filter((it) => {
        const sy = -it.y
        return sy > vbY - 2 && sy < vbY + vbH + 2
      })
  }, [maxTop, level.id, vbY, vbH])

  // 卸载时清理所有挂起定时器，避免卸载后 setState
  useEffect(
    () => () => {
      window.clearTimeout(shakeTimer.current)
      window.clearTimeout(bannerTimer.current)
      window.clearTimeout(flashTimer.current)
      window.clearTimeout(gainTimer.current)
    },
    []
  )

  // 滚轮缩放（以光标为锚点）。React 合成 onWheel 为 passive，必须原生监听
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { zoom: z, pan: p, viewTop: vt } = camRef.current
      const rect = svg.getBoundingClientRect()
      const u = (e.clientX - rect.left) / rect.width
      const v = (e.clientY - rect.top) / rect.height
      const next = clamp(z * Math.exp(-e.deltaY * 0.0016), ZOOM_MIN, ZOOM_MAX)
      if (next === z) return
      const w0 = 100 / z
      const h0 = 68 / z
      const px = 50 + p.x - w0 / 2 + u * w0
      const py = -vt - 30 + p.y - h0 / 2 + v * h0
      const w1 = 100 / next
      const h1 = 68 / next
      const np = clampPan(px - (u - 0.5) * w1 - 50, py - (v - 0.5) * h1 + vt + 30)
      setZoom(next)
      setPan(np)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // 里程碑横幅：新关卡 / 新场景装饰解锁（由历史最高高度推导，无需持久化）
  const prevMaxTop = useRef(maxTop)
  useEffect(() => {
    const prev = prevMaxTop.current
    if (maxTop > prev) {
      prevMaxTop.current = maxTop
      const crossed: { title: string; sub: string }[] = []
      for (const l of LEVELS) if (l.unlockAt > 0 && prev < l.unlockAt && maxTop >= l.unlockAt) crossed.push({ title: `新关卡解锁 · ${l.name}`, sub: l.desc })
      for (const defs of Object.values(SCENE_PROPS))
        for (const p of defs) if (prev < p.unlockAt && maxTop >= p.unlockAt) crossed.push({ title: `场景装饰解锁 · ${p.name}`, sub: '' })
      if (crossed.length) {
        const c = crossed[crossed.length - 1]
        setBanner({ ...c, key: Date.now() })
        window.clearTimeout(bannerTimer.current)
        bannerTimer.current = window.setTimeout(() => setBanner(null), 2900)
      }
    }
  }, [maxTop])

  const doPlace = async (invId: string, x: number) => {
    const before = useTower.getState().maxTop
    const r = await place(invId, x)
    if (r.fell) {
      useUi.getState().toast('房顶塌了！已回退到上一块之前', 'error')
      setCombo(0) // 连击中断
      setShake(true)
      setShakeKey((k) => k + 1)
      window.clearTimeout(shakeTimer.current)
      shakeTimer.current = window.setTimeout(() => setShake(false), 620)
      return
    }
    if (r.ok) {
      // 连续成功放置 +1（撤回/塌落清零），并刷新历史最高连击（只增不减）
      const nc = combo + 1
      setCombo(nc)
      if (nc > useTower.getState().maxCombo) void useTower.getState().setMaxCombo(nc)
      // 新纪录：楼高超过放置前的历史最高
      if (useTower.getState().maxTop > before) {
        setRecordFlash(true)
        window.clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => setRecordFlash(false), 2400)
        // 落点浮动增量数字（上浮淡出），与「新纪录」闪烁、里程碑横幅构成三拍反馈
        setGain({ id: Date.now(), h: +(useTower.getState().maxTop - before).toFixed(1) })
        window.clearTimeout(gainTimer.current)
        gainTimer.current = window.setTimeout(() => setGain(null), 1100)
      }
      setBounceKey((k) => k + 1) // 最新块下落弹跳
    }
  }

  const posFromEvent = (e: { clientX: number; currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return vbX + ((e.clientX - rect.left) / rect.width) * vbW
  }

  const onDrop = (e: RDragEvent<SVGSVGElement>) => {
    e.preventDefault()
    const invId = draggingRef.current || e.dataTransfer.getData('text/plain')
    draggingRef.current = null
    if (!invId) return
    setGhost(null)
    void doPlace(invId, posFromEvent(e))
  }

  // 兜底交互：点选库存积木后点击画布放置（仅左键；中键平移松开不误触）
  const onCanvasClick = (e: RMouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    if (!selectedInv) return
    const invId = selectedInv
    void doPlace(invId, posFromEvent(e))
    // 连续放置：同形状库存还有剩余则自动选中下一块（虚影形状不变，落点随楼高实时重算），否则退出放置模式
    const shapeId = inventory.find((i) => i.id === invId)?.shapeId
    const next = inventory.find((i) => i.id !== invId && i.shapeId === shapeId)
    setSelectedInv(next ? next.id : null)
  }

  // 右键/中键拖拽平移
  const onCamDown = (e: RMouseEvent<SVGSVGElement>) => {
    if (e.button !== 1 && e.button !== 2) return
    const rect = svgRef.current?.getBoundingClientRect()
    panDrag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, scale: rect ? vbW / rect.width : 1 }
    setPanning(true)
  }
  const onCamMove = (e: RMouseEvent<SVGSVGElement>) => {
    const d = panDrag.current
    if (d) {
      setPan(clampPan(d.px + (e.clientX - d.sx) * d.scale, d.py + (e.clientY - d.sy) * d.scale))
      return
    }
    // 非拖拽平移时：放置模式下实时更新落点虚影
    if (!selectedInv) return
    const it = inventory.find((i) => i.id === selectedInv)
    const shape = it ? shapes.find((s) => s.id === it.shapeId) : undefined
    if (!it || !shape) return
    const bb = bboxOfCells(shape.cells)
    setGhost({ x: posFromEvent(e), w: bb.w, h: bb.h })
  }
  const endPan = () => {
    panDrag.current = null
    setPanning(false)
  }

  return (
    <section className="lh-panel p-4">
      <div className="lh-section-title">积木画布</div>

      {/* 画布（含解锁横幅浮层） */}
      <div className="relative mx-auto mt-3 w-full max-w-xl select-none">
        <svg
          ref={svgRef}
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          style={{ aspectRatio: '100 / 68' }}
          className={`block w-full rounded-lg border border-line bg-bg ${panning ? 'cursor-grabbing' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={onCanvasClick}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={onCamDown}
          onMouseMove={onCamMove}
          onMouseUp={endPan}
          onMouseLeave={() => {
            setGhost(null)
            endPan()
          }}
        >
          <LevelBackdrop level={level} topY={vbY - 6} botY={vbY + vbH + 6} />
          <LevelProps level={level} maxTop={maxTop} />
          {/* 待解锁目标刻度线（世界高度 h 对应 svg y = -h） */}
          {guides.map((g) => {
            const sy = -g.y
            const remain = Math.max(0, Math.ceil(g.y - topH))
            return (
              <g key={g.label}>
                <line x1={vbX} x2={vbX + vbW} y1={sy} y2={sy} stroke="rgba(125,135,155,0.35)" strokeWidth={0.12} strokeDasharray="1.6 1.6" />
                <text x={vbX + vbW - 1} y={sy - 0.8} textAnchor="end" fontSize={2.4} fill="rgba(125,135,155,0.85)">
                  {`再高 ${remain} 解锁 · ${g.label}`}
                </text>
              </g>
            )
          })}
          {!placed.length && (
            <text x="50" y={-(roofY + ROOF.h + 16)} textAnchor="middle" fontSize="3.1" fill={level.id === 'night' ? 'rgba(230,236,247,0.8)' : 'rgba(30,40,60,0.5)'}>
              从下方库存拖入积木，接住房顶开始搭建
            </text>
          )}
          {placed.map((p) => {
            const body = bodyById.get(p.id)
            const shape = shapes.find((s) => s.id === p.shapeId)
            if (!body || !shape || !shape.cells.length) return null
            const bb = bboxOfCells(shape.cells)
            const bnd = cellsBounds(shape.cells)
            const color = BLOCK_COLORS[p.color % BLOCK_COLORS.length]
            const isNew = p.id === lastPlacedId && bounceKey > 0
            return (
              <g key={isNew ? `${p.id}:${bounceKey}` : p.id} className={isNew ? 'lh-drop-bounce' : undefined}>
                {shape.cells.map((c) => {
                  const col = c % GRID
                  const row = Math.floor(c / GRID)
                  const x0 = p.x - bb.w / 2 + (col - bnd.minC) * CELL
                  const yTop = body.y + (bnd.maxR - row + 1) * CELL
                  return (
                    <rect
                      key={c}
                      x={x0 + 0.15}
                      y={-yTop + 0.15}
                      width={CELL - 0.3}
                      height={CELL - 0.3}
                      rx={0.5}
                      fill={color}
                      stroke="rgba(0,0,0,0.18)"
                      strokeWidth={0.15}
                    />
                  )
                })}
              </g>
            )
          })}
          {/* 放置落点虚影：仅放置模式下显示，示意这块积木将落在哪里 */}
          {ghost && selectedInv && (
            <g pointerEvents="none">
              <rect
                x={ghost.x - ghost.w / 2 + 0.15}
                y={-dropY(bodies, ghost.x, ghost.w) + 0.15}
                width={ghost.w - 0.3}
                height={ghost.h - 0.3}
                rx={0.5}
                fill="rgba(91,141,239,0.22)"
                stroke="#5b8def"
                strokeWidth={0.3}
                strokeDasharray="0.9 0.7"
              />
            </g>
          )}
          <LevelRoof key={shakeKey} level={level} y={roofY} shake={shake} beamOn={maxTop >= beamAt} />
          {/* 破纪录增量浮动数字：楼顶上方弹出 +N */}
          {gain && (
            <text
              key={gain.id}
              x={ROOF.cx}
              y={roofY - 4}
              textAnchor="middle"
              className="lh-gain"
              style={{ fontSize: 5.5, fontWeight: 700, fill: '#f5a623' }}
            >
              +{gain.h}
            </text>
          )}
        </svg>

        {/* 里程碑解锁横幅 */}
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          {banner && (
            <div key={banner.key} className="lh-banner rounded-lg border border-accent/60 bg-bg-card/95 px-4 py-2 text-center shadow-lg">
              <div className="text-sm font-semibold text-accent">{banner.title}</div>
              {banner.sub && <div className="mt-0.5 text-xs text-txt-dim">{banner.sub}</div>}
            </div>
          )}
        </div>
      </div>

      {/* HUD：楼高 + 新纪录 + 下一关进度 + 相机控制 + 撤回 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs">
          <span className="text-txt-dim">当前楼高</span>
          <span className="font-semibold">{topH.toFixed(1)}</span>
        </span>
        {recordFlash && (
          <span className="lh-flash inline-flex items-center rounded-md border border-accent bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
            新纪录 {topH.toFixed(1)}
          </span>
        )}
        {combo >= 2 && (
          <span key={combo} className="lh-pop inline-flex items-center rounded-md border border-accent bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
            连击 x{combo}
          </span>
        )}
        {nextLevel ? (
          <div className="flex min-w-44 flex-1 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-hover">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.min(100, (maxTop / nextLevel.unlockAt) * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-txt-dim">
              {nextLevel.name} {Math.min(maxTop, nextLevel.unlockAt).toFixed(0)}/{nextLevel.unlockAt}
            </span>
          </div>
        ) : (
          <span className="text-xs text-txt-dim">全部关卡已解锁</span>
        )}
        <button type="button" className={chipBtn} onClick={() => setZoom((z) => clamp(z / 1.25, ZOOM_MIN, ZOOM_MAX))} title="缩小视野">
          缩小
        </button>
        <button type="button" className={chipBtn} onClick={() => setZoom((z) => clamp(z * 1.25, ZOOM_MIN, ZOOM_MAX))} title="放大视野">
          放大
        </button>
        <button type="button" className={chipBtn} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="恢复默认视角">
          重置视角
        </button>
        <button type="button" className={chipBtn} disabled={!placed.length} onClick={() => { setCombo(0); void withdrawLast() }}>
          撤回上一块
        </button>
      </div>

      {/* 场景装饰解锁状态 */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-txt-dim">场景装饰</span>
        {(SCENE_PROPS[level.id] ?? []).map((p) => {
          const on = maxTop >= p.unlockAt
          return (
            <span
              key={p.id}
              className={`rounded-md border px-2 py-0.5 text-xs ${on ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-txt-dim'}`}
            >
              {on ? p.name : `${p.name} · ${p.unlockAt} 高度解锁`}
            </span>
          )
        })}
        <span className="ml-auto text-xs text-txt-dim">滚轮缩放 · 右键拖动平移</span>
      </div>

      {/* 关卡条 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {LEVELS.map((l, idx) => {
          const locked = idx >= unlocked
          const active = l.id === levelId
          return (
            <button
              key={l.id}
              type="button"
              title={l.desc}
              disabled={locked}
              onClick={() => void switchLevel(l.id)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                locked
                  ? 'cursor-not-allowed border-line text-txt-dim opacity-50'
                  : active
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-line text-txt hover:border-accent hover:text-accent'
              }`}
            >
              {locked ? `${l.name} · ${l.unlockAt} 高度解锁` : l.name}
            </button>
          )
        })}
      </div>

      {/* 库存条 */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-txt-dim">积木库存（{inventory.length}）</span>
          <span className="text-xs text-txt-dim">{selectedInv ? '已选中，点击画布放置' : '拖拽积木到画布，或点选后点画布'}</span>
        </div>
        {inventory.length === 0 ? (
          <div className="lh-empty-state mt-1.5 py-3 text-xs">领取成就获得积木</div>
        ) : (
          <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
            {inventory.map((it) => {
              const shape = shapes.find((s) => s.id === it.shapeId)
              const selected = selectedInv === it.id
              return (
                <button
                  key={it.id}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', it.id)
                    e.dataTransfer.effectAllowed = 'move'
                    draggingRef.current = it.id
                  }}
                  onDragEnd={() => {
                    draggingRef.current = null
                  }}
                  onClick={() => setSelectedInv((v) => (v === it.id ? null : it.id))}
                  style={{ cursor: 'grab' }}
                  className={`flex shrink-0 items-center justify-center rounded-md border px-2 py-1.5 transition-colors ${
                    selected ? 'border-accent bg-accent/10' : 'border-line hover:border-accent'
                  }`}
                >
                  {shape && <CellsSvg cells={shape.cells} color={BLOCK_COLORS[it.color % BLOCK_COLORS.length]} cell={5} />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 形状库 */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-txt-dim">形状库（{shapes.length}）</span>
          <button
            type="button"
            className="rounded-md border border-line px-2.5 py-1 text-xs transition-colors hover:border-accent hover:text-accent"
            onClick={onOpenDrawer}
          >
            画一个新形状
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {shapes.map((s) => {
            const inUse = placed.some((p) => p.shapeId === s.id)
            return (
              <div key={s.id} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5">
                <CellsSvg cells={s.cells} color="#8a93a8" cell={3.5} />
                <span className="max-w-24 truncate text-xs" title={s.name}>
                  {s.name}
                </span>
                {!s.preset && (
                  <button
                    type="button"
                    disabled={inUse}
                    title={inUse ? '已放置在楼上的形状不能删除' : undefined}
                    className="rounded border border-red-500/60 px-1.5 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void removeCustomShape(s.id)}
                  >
                    删除
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
