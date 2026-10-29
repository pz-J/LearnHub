import { useEffect, useMemo, useRef, useState } from 'react'
import { ACHIEVEMENT_DEFS, useAchievements } from '@/stores/achievements'
import { BLOCK_COLORS, useTower, type ShapeDef } from '@/stores/tower'
import { usePapers } from '@/stores/papers'
import { useFlashcards } from '@/stores/flashcards'
import { useTodos } from '@/stores/todos'
import { useFocus } from '@/stores/misc'
import { useMindmaps } from '@/stores/mindmaps'
import { useNotes } from '@/stores/notes'
import { useUi } from '@/stores/ui'
import { TowerGame } from './TowerGame'
import { CellsSvg, ShapeDrawer } from './ShapeDrawer'

/** 画布/场景动画（仅 CSS：房顶抖动一次 + 三处极慢循环） */
const GAME_CSS = `
@keyframes lh-roof-shake{0%,100%{transform:translate(0,0) rotate(0deg)}15%{transform:translate(-1px,0.4px) rotate(-1.4deg)}35%{transform:translate(1px,-0.3px) rotate(1.2deg)}55%{transform:translate(-0.8px,0.3px) rotate(-1deg)}75%{transform:translate(0.7px,-0.2px) rotate(0.8deg)}90%{transform:translate(-0.4px,0.1px) rotate(-0.4deg)}}
.lh-roof-shake{animation:lh-roof-shake 600ms ease-in-out both}
@keyframes lh-cloud-drift{0%,100%{transform:translateX(-2.5px)}50%{transform:translateX(2.5px)}}
.lh-cloud{animation:lh-cloud-drift 22s ease-in-out infinite}
@keyframes lh-roll{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
.lh-roll{animation:lh-roll 16s ease-in-out infinite}
@keyframes lh-petal-fall{0%{transform:translate(0,-2px);opacity:0}20%{opacity:1}80%{opacity:1}100%{transform:translate(2.5px,5px);opacity:0}}
.lh-petal{animation:lh-petal-fall 9s linear infinite}
@keyframes lh-drop{0%{transform:translateY(-5px)}55%{transform:translateY(0)}75%{transform:translateY(-1.2px)}100%{transform:translateY(0)}}
.lh-drop-bounce{animation:lh-drop 420ms cubic-bezier(0.3,0.7,0.4,1) both}
@keyframes lh-gain-up{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-13px);opacity:0}}
.lh-gain{animation:lh-gain-up 1.1s ease-out both;pointer-events:none}
@keyframes lh-stat-glow{0%,100%{box-shadow:0 0 0 0 rgba(74,158,255,0)}50%{box-shadow:0 0 0 4px rgba(74,158,255,0.14)}}
.lh-stat-glow{animation:lh-stat-glow 2.2s ease-in-out infinite}
@keyframes lh-flash{0%,100%{opacity:1}50%{opacity:0.3}}
.lh-flash{animation:lh-flash 1.1s ease-in-out 2}
@keyframes lh-banner-in{0%{opacity:0;transform:translateY(-8px)}12%{opacity:1;transform:translateY(0)}85%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-4px)}}
.lh-banner{animation:lh-banner-in 2.8s ease both}
@keyframes lh-fly-x{from{transform:translateX(-12px)}to{transform:translateX(112px)}}
.lh-fly{animation:lh-fly-x 38s linear infinite}
@keyframes lh-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(1.1px)}}
.lh-bob{animation:lh-bob 2.7s ease-in-out infinite}
@keyframes lh-shuttle{from{transform:translateX(0)}to{transform:translateX(56px)}}
.lh-shuttle{animation:lh-shuttle 20s ease-in-out infinite alternate}
@keyframes lh-drift{0%,100%{transform:translate(0,0)}50%{transform:translate(3.5px,-2.5px)}}
.lh-drift{animation:lh-drift 18s ease-in-out infinite alternate}
@keyframes lh-camel-x{from{transform:translateX(-16px)}to{transform:translateX(116px)}}
.lh-camel{animation:lh-camel-x 36s linear infinite}
@keyframes lh-flutter{0%{transform:translate(0,0)}25%{transform:translate(6px,-2.5px)}50%{transform:translate(13px,0.8px)}75%{transform:translate(20px,-2px)}100%{transform:translate(28px,0.4px)}}
.lh-flutter{animation:lh-flutter 14s ease-in-out infinite alternate}
@keyframes lh-meteor{0%{opacity:0;transform:translate(9px,-4.5px)}5%{opacity:1}13%{opacity:0;transform:translate(-9px,4.5px)}100%{opacity:0;transform:translate(-9px,4.5px)}}
.lh-meteor{animation:lh-meteor 9s linear infinite}
@keyframes lh-claim-pop{0%{transform:scale(0.72);opacity:0}60%{transform:scale(1.06);opacity:1}100%{transform:scale(1);opacity:1}}
.lh-claim-pop{animation:lh-claim-pop 450ms cubic-bezier(0.34,1.56,0.64,1) both}
@keyframes lh-pop{0%{transform:scale(0.7)}60%{transform:scale(1.18)}100%{transform:scale(1)}}
.lh-pop{animation:lh-pop 300ms cubic-bezier(0.34,1.56,0.64,1) both}`

/** 隐藏作弊码：↑↑↓↓←→←→ b a b a（金色测试积木） */
const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a', 'b', 'a']

interface ClaimTarget {
  kind: 'achievement' | 'task'
  id: string
  title: string
}

/** 领取弹层：形状库全量网格 + 前 6 色调色板（金色为作弊码专属不入弹层） */
function ClaimModal({
  target,
  injectedShape,
  onRequestDrawer,
  onClose
}: {
  target: ClaimTarget
  injectedShape: ShapeDef | null
  onRequestDrawer: () => void
  onClose: () => void
}) {
  const shapes = useTower((s) => s.shapes)
  const claim = useAchievements((s) => s.claim)
  const claimTask = useAchievements((s) => s.claimTask)
  const [shapeId, setShapeId] = useState<string | null>(null)
  const [color, setColor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // 绘制器保存后自动选中新形状
  useEffect(() => {
    if (injectedShape) setShapeId(injectedShape.id)
  }, [injectedShape])

  // 领取成功：展示成功动效后自动关闭（onClose 经 ref 读取，避免计时器反复重置）
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(() => closeRef.current(), 950)
    return () => window.clearTimeout(t)
  }, [done])

  const confirm = async () => {
    if (!shapeId || busy || done) return
    setBusy(true)
    try {
      if (target.kind === 'achievement') await claim(target.id, shapeId, color)
      else await claimTask(target.id, shapeId, color)
      setDone(true)
    } catch (error) {
      useUi.getState().toast(`领取失败：${(error as Error)?.message || '本地保存失败，请重试'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={() => closeRef.current()}>
        <div className="lh-claim-pop lh-panel w-full max-w-md p-4 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-base font-semibold text-accent">领取成功</div>
          <div className="mt-1 text-xs text-txt-dim">积木已入库存，去画布放置</div>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="lh-panel max-h-full w-full max-w-md overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="lh-section-title">选择积木</div>
        <div className="mt-1 truncate text-xs text-txt-dim">{target.title}</div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-txt-dim">形状</span>
          <button
            type="button"
            className="rounded-md border border-line px-2 py-1 text-xs transition-colors hover:border-accent hover:text-accent"
            onClick={onRequestDrawer}
          >
            画一个新形状
          </button>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-2">
          {shapes.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setShapeId(s.id)}
              className={`flex flex-col items-center gap-1 rounded-md border p-2 transition-colors ${
                shapeId === s.id ? 'border-accent bg-accent/10' : 'border-line hover:border-accent'
              }`}
            >
              <CellsSvg cells={s.cells} color="#8a93a8" cell={4} />
              <span className="w-full truncate text-center text-xs text-txt-dim">{s.name}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 text-xs text-txt-dim">颜色</div>
        <div className="mt-1.5 flex gap-2">
          {BLOCK_COLORS.slice(0, 6).map((c, i) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(i)}
              className={`h-7 w-7 rounded-md border-2 transition-colors ${color === i ? 'border-accent' : 'border-transparent hover:border-line'}`}
              style={{ backgroundColor: c }}
            >
              <span className="sr-only">颜色 {i + 1}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="lh-button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="lh-button lh-button-primary" disabled={!shapeId || busy} onClick={() => void confirm()}>
            {busy ? '领取中' : '确认领取'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 内置子模块：成就大楼（物理搭建小游戏 + 成就/任务领取积木） */
export function AchievementsModule() {
  const claimedIds = useAchievements((s) => s.claimedIds)
  const customTasks = useAchievements((s) => s.customTasks)
  const moduleTasks = useAchievements((s) => s.moduleTasks)
  const addCustomTask = useAchievements((s) => s.addCustomTask)
  const toggleCustomTask = useAchievements((s) => s.toggleCustomTask)
  const removeCustomTask = useAchievements((s) => s.removeCustomTask)
  const togglePaperFinished = useAchievements((s) => s.togglePaperFinished)

  const papers = usePapers((s) => s.papers)
  const order = usePapers((s) => s.order)
  const flashcards = useFlashcards((s) => s.items)
  const todos = useTodos((s) => s.items)
  const focusSessions = useFocus((s) => s.sessions)
  const maps = useMindmaps((s) => s.maps)
  const notes = useNotes((s) => s.notes)
  const towerMaxTop = useTower((s) => s.maxTop)
  const towerMaxCombo = useTower((s) => s.maxCombo)
  const inventoryCount = useTower((s) => s.inventory.length)

  const [ready, setReady] = useState(false)
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null)
  const [injectedShape, setInjectedShape] = useState<ShapeDef | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

  // 加载顺序关键：先 tower 再 achievements（旧数据迁移要写入 tower）
  useEffect(() => {
    let alive = true
    setLoadError('')
    void (async () => {
      try {
        await useTower.getState().load()
        await useAchievements.getState().load()
        if (alive) setReady(true)
      } catch (error) {
        if (alive) setLoadError((error as Error)?.message || '无法读取本地成就数据，请重试。')
      }
    })()
    return () => {
      alive = false
    }
  }, [loadAttempt])

  // 作弊码：滑动窗口匹配完整序列后发放金色测试积木
  useEffect(() => {
    let buf: string[] = []
    const onKey = (e: KeyboardEvent) => {
      buf = [...buf, e.key.toLowerCase()].slice(-KONAMI.length)
      if (buf.length === KONAMI.length && KONAMI.every((k, i) => buf[i] === k)) {
        buf = []
        void useTower.getState().konami()
        useUi.getState().toast('测试积木已发放', 'ok')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const progress = useMemo(() => useAchievements.getState().progress(), [papers, flashcards, todos, focusSessions, maps, notes, claimedIds, towerMaxTop, towerMaxCombo])

  // 可领取数（统计条用）
  const claimableCount = useMemo(
    () => ACHIEVEMENT_DEFS.filter((d) => !claimedIds.includes(d.id) && (progress[d.metric] ?? 0) >= d.target).length,
    [progress, claimedIds]
  )

  // 成就排序：可领取置顶 → 进行中（按进度降序，接近达成的排前面）→ 已领取置底
  const sortedDefs = useMemo(() => {
    const claimable: typeof ACHIEVEMENT_DEFS = []
    const active: typeof ACHIEVEMENT_DEFS = []
    const done: typeof ACHIEVEMENT_DEFS = []
    for (const def of ACHIEVEMENT_DEFS) {
      const raw = progress[def.metric] ?? 0
      if (claimedIds.includes(def.id)) done.push(def)
      else if (raw >= def.target) claimable.push(def)
      else active.push(def)
    }
    active.sort((a, b) => (progress[b.metric] ?? 0) / b.target - (progress[a.metric] ?? 0) / a.target)
    return [...claimable, ...active, ...done]
  }, [progress, claimedIds])

  const submitCustomTask = async () => {
    const title = taskTitle.trim()
    if (!title) return
    try {
      await addCustomTask(title)
      setTaskTitle('')
      useUi.getState().toast('任务已保存', 'ok')
    } catch (error) {
      useUi.getState().toast(`任务保存失败：${(error as Error)?.message || '请重试'}`, 'error')
    }
  }

  const runTaskMutation = async (action: () => Promise<void>, success: string) => {
    try {
      await action()
      useUi.getState().toast(success, 'ok')
    } catch (error) {
      useUi.getState().toast(`操作未保存：${(error as Error)?.message || '请重试'}`, 'error')
    }
  }

  const openDrawer = () => setDrawerOpen(true)

  const openClaim = (target: ClaimTarget) => {
    setInjectedShape(null)
    setClaimTarget(target)
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-4">
        <div className="lh-empty-state max-w-md">{loadError ? <><div className="font-medium text-txt">成就数据暂时无法加载</div><p className="mt-1">{loadError}</p><button className="lh-button lh-button-primary mt-3" onClick={() => setLoadAttempt((n) => n + 1)}>重试</button></> : '正在准备你的成就大楼…'}</div>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <style>{GAME_CSS}</style>
      <div className="h-full overflow-y-auto p-4">
        <h1 className="mb-4 text-lg font-semibold">成就大楼</h1>
        <div className="space-y-4">
          {/* 一、学习成果统计条 */}
          <section className="lh-panel p-4">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <Stat label="历史最高楼高" value={towerMaxTop.toFixed(1)} />
              <Stat label="最高连击" value={'x' + towerMaxCombo} />
              <Stat label="待放置积木" value={String(inventoryCount)} />
              <Stat label="可领取成就" value={String(claimableCount)} highlight={claimableCount > 0} />
              <Stat label="已领成就" value={`${claimedIds.length}/${ACHIEVEMENT_DEFS.length}`} />
            </div>
          </section>

          {/* 二、画布 + HUD/关卡条 + 库存条 + 形状库 */}
          <TowerGame onOpenDrawer={openDrawer} />

          {/* 三、成就列表（可领取置顶） */}
          <section className="lh-panel p-4">
            <div className="lh-section-title">成就</div>
            <div className="mt-1 divide-y divide-line">
              {sortedDefs.map((def) => {
                const raw = progress[def.metric] ?? 0
                const reached = raw >= def.target
                const claimed = claimedIds.includes(def.id)
                const pct = Math.min(100, Math.round((raw / def.target) * 100))
                return (
                  <div key={def.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{def.title}</div>
                        <div className="mt-0.5 text-xs text-txt-dim">{def.desc}</div>
                      </div>
                      {claimed ? (
                        <span className="rounded-md border border-line px-2 py-1 text-xs text-txt-dim">已领取</span>
                      ) : reached ? (
                        <button
                          type="button"
                          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
                          onClick={() => openClaim({ kind: 'achievement', id: def.id, title: def.title })}
                        >
                          领取积木
                        </button>
                      ) : (
                        <span className="rounded-md border border-line px-2 py-1 text-xs text-txt-dim">进行中</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-hover">
                        <div
                          className={`h-full rounded-full transition-all ${claimed ? 'bg-txt-dim/50' : 'bg-accent'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-14 text-right text-xs text-txt-dim">
                        {Math.min(raw, def.target)}/{def.target}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* 四、任务换积木 */}
          <section className="lh-panel p-4">
            <div className="lh-section-title">任务换积木</div>

            {/* 子块 1：论文完成清单 */}
            <div className="mt-3 text-xs text-txt-dim">论文完成清单</div>
            <div className="mt-1.5">
              {order.length === 0 ? (
                <div className="lh-empty-state">先去导入论文</div>
              ) : (
                <div className="space-y-1">
                  {order.map((id) => {
                    const p = papers[id]
                    if (!p) return null
                    return (
                      <div key={id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm" title={p.title}>
                          {p.title}
                        </span>
                        <button
                          type="button"
                          className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                            p.finished
                              ? 'border-green-500/60 bg-green-500/10 text-green-400'
                              : 'border-line text-txt-dim hover:border-accent hover:text-accent'
                          }`}
                          onClick={() => void togglePaperFinished(id)}
                        >
                          {p.finished ? '已读完' : '读完'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 子块 2：自定义任务 */}
            <div className="mt-4 text-xs text-txt-dim">自定义任务</div>
            <form
              className="mt-1.5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submitCustomTask()
              }}
            >
              <input
                className="lh-input flex-1"
                placeholder="写下任务，完成后领取积木"
                value={taskTitle}
                maxLength={60}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
              <button type="submit" className="lh-button" disabled={!taskTitle.trim()}>
                添加
              </button>
            </form>
            <div className="mt-2 space-y-1">
              {customTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      t.done
                        ? 'border-green-500/60 bg-green-500/10 text-green-400'
                        : 'border-line text-txt-dim hover:border-accent hover:text-accent'
                    }`}
                          onClick={() => void runTaskMutation(() => toggleCustomTask(t.id), t.done ? '任务已重新打开' : '任务已完成并保存')}
                  >
                    {t.done ? '已完成' : '完成'}
                  </button>
                  <span className={`min-w-0 flex-1 truncate text-sm ${t.done ? 'text-txt-dim line-through' : ''}`}>{t.title}</span>
                  {t.done && !t.claimed && (
                    <button
                      type="button"
                      className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
                      onClick={() => openClaim({ kind: 'task', id: t.id, title: t.title })}
                    >
                      领取积木
                    </button>
                  )}
                  {t.claimed && <span className="rounded-md border border-line px-2 py-1 text-xs text-txt-dim">已领取</span>}
                  <button
                    type="button"
                    className="rounded-md border border-red-500/60 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                    onClick={() => void runTaskMutation(() => removeCustomTask(t.id), '任务已删除')}
                  >
                    删除
                  </button>
                </div>
              ))}
              {customTasks.length === 0 && <div className="py-1 text-xs text-txt-dim">还没有自定义任务</div>}
            </div>

            {/* 子块 3：模块任务（有记录才渲染） */}
            {moduleTasks.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-txt-dim">模块任务</div>
                <div className="mt-1.5 space-y-1">
                  {moduleTasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2">
                      <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-xs text-txt-dim">{t.moduleId}</span>
                      <span className="min-w-0 flex-1 truncate text-sm" title={t.title}>
                        {t.title}
                      </span>
                      {t.claimed ? (
                        <span className="rounded-md border border-line px-2 py-1 text-xs text-txt-dim">已领取</span>
                      ) : (
                        <button
                          type="button"
                          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
                          onClick={() => openClaim({ kind: 'task', id: t.id, title: t.title })}
                        >
                          领取积木
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 领取弹层与绘制器（绘制器在其上层，保存后回到弹层并自动选中） */}
      {claimTarget && (
        <ClaimModal target={claimTarget} injectedShape={injectedShape} onRequestDrawer={openDrawer} onClose={() => setClaimTarget(null)} />
      )}
      {drawerOpen && <ShapeDrawer onSaved={(shape) => setInjectedShape(shape)} onClose={() => setDrawerOpen(false)} />}
    </div>
  )
}

/** 统计格：数字大字 + 说明小字；highlight 时用强调色 + 呼吸边框提示有可领取奖励 */
function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${highlight ? 'lh-stat-glow border-accent/60 bg-accent/10' : 'border-line'}`}>
      <div className={`text-xl font-semibold ${highlight ? 'text-accent' : ''}`}>{value}</div>
      <div className="mt-0.5 text-xs text-txt-dim">{label}</div>
    </div>
  )
}
