import { useState } from 'react'
import { GRID } from '@/lib/towerPhysics'
import { useTower, type ShapeDef } from '@/stores/tower'

/** 8x8 格子集合的占用范围（row 0 在网格顶部，与绘制器渲染方向一致） */
export function cellsBounds(cells: number[]): { minC: number; minR: number; maxC: number; maxR: number } {
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
  return { minC, minR, maxC, maxR }
}

/** 按格子集合渲染的小预览（1 格 = cell 像素，格子间留 gap 缝隙） */
export function CellsSvg({
  cells,
  color,
  cell = 5,
  gap = 0.8,
  className
}: {
  cells: number[]
  color: string
  cell?: number
  gap?: number
  className?: string
}) {
  if (!cells.length) return null
  const b = cellsBounds(cells)
  const w = (b.maxC - b.minC + 1) * cell
  const h = (b.maxR - b.minR + 1) * cell
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      {cells.map((c) => {
        const col = c % GRID
        const row = Math.floor(c / GRID)
        return (
          <rect
            key={c}
            x={(col - b.minC) * cell + gap / 2}
            y={(row - b.minR) * cell + gap / 2}
            width={cell - gap}
            height={cell - gap}
            rx={cell * 0.18}
            fill={color}
          />
        )
      })}
    </svg>
  )
}

/** 形状绘制器：8x8 点格点击 toggle，实时 bbox 裁剪预览，保存为自画形状 */
export function ShapeDrawer({ onSaved, onClose }: { onSaved?: (shape: ShapeDef) => void; onClose: () => void }) {
  const addCustomShape = useTower((s) => s.addCustomShape)
  const [cells, setCells] = useState<number[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const toggle = (idx: number) => setCells((prev) => (prev.includes(idx) ? prev.filter((c) => c !== idx) : [...prev, idx]))

  const save = async () => {
    if (!cells.length || saving) return
    setSaving(true)
    try {
      const shape = await addCustomShape(name, cells)
      onSaved?.(shape)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const b = cellsBounds(cells)
  const span = Math.max(b.maxC - b.minC + 1, b.maxR - b.minR + 1, 1)
  const previewCell = Math.min(12, Math.round((106 / span) * 10) / 10)

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="lh-panel w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <div className="lh-section-title">画一个新形状</div>
        <div className="mt-3 flex gap-4">
          <div className="grid w-fit grid-cols-8 gap-0.5">
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const on = cells.includes(i)
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`格子 ${i + 1}`}
                  onClick={() => toggle(i)}
                  className={`h-6 w-6 rounded border transition-colors ${
                    on ? 'border-accent bg-accent/40' : 'border-line bg-bg hover:border-txt-dim'
                  }`}
                />
              )
            })}
          </div>
          <div className="flex flex-col items-center">
            <div className="text-xs text-txt-dim">预览</div>
            <div className="mt-1 flex h-28 w-28 items-center justify-center rounded-md border border-dashed border-line">
              {cells.length ? (
                <CellsSvg cells={cells} color="#8a93a8" cell={previewCell} />
              ) : (
                <span className="px-2 text-center text-xs text-txt-dim">点击左侧格子绘制</span>
              )}
            </div>
          </div>
        </div>
        <input
          className="lh-input mt-3"
          placeholder="形状名称（12 字以内）"
          maxLength={12}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-txt-dim">{cells.length ? `已填 ${cells.length} 格` : '至少填 1 格才能保存'}</span>
          <div className="flex gap-2">
            <button type="button" className="lh-button" onClick={onClose}>
              取消
            </button>
            <button type="button" className="lh-button lh-button-primary" disabled={!cells.length || saving} onClick={() => void save()}>
              {saving ? '保存中' : '保存形状'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
