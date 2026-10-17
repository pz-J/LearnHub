import { create } from 'zustand'
import { lh } from '@/lib/ipc'
import { useFocus } from '@/stores/misc'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import type { PomodoroCfg } from '@/types'

/**
 * 内置子模块：番茄钟。
 * 完成一轮专注自动记录 focus-log 并发系统通知；支持配置时长/循环次数/休息时长/强制专注。
 * 强制专注：全屏置顶 + 底层键盘钩子拦截 Win/Alt+Tab；休息与结束时自动放开；「紧急停止」随时退出。
 */

const DEFAULT_CFG: PomodoroCfg = { focusMin: 25, breakMin: 5, cycles: 4, force: false }

interface PomodoroState {
  mode: 'work' | 'break'
  running: boolean
  remaining: number // 秒
  cur: number // 当前轮次（1 起）
  uiOpen: boolean
  setUiOpen: (v: boolean) => void
  cfg: () => PomodoroCfg
  setCfg: (patch: Partial<PomodoroCfg>) => void
  start: () => void
  pause: () => void
  reset: () => void
  /** 紧急停止：立即结束并放开强制专注 */
  emergencyStop: () => void
  tick: () => void
}

let timer: ReturnType<typeof setInterval> | null = null

function ensureTimer() {
  if (timer) return
  timer = setInterval(() => usePomodoro.getState().tick(), 1000)
}

function forceHook(on: boolean): void {
  void lh
    .pomForce(on)
    .then((r) => {
      if (on && r && !r.hooked) useUi.getState().toast('系统级键盘拦截不可用，已仅全屏置顶', 'error')
    })
    .catch(() => {
      if (on) useUi.getState().toast('强制专注调用失败', 'error')
    })
}

export const usePomodoro = create<PomodoroState>((set, get) => ({
  mode: 'work',
  running: false,
  remaining: DEFAULT_CFG.focusMin * 60,
  cur: 1,
  uiOpen: false,
  setUiOpen: (v) => set({ uiOpen: v }),
  cfg: () => useSettings.getState().settings.pomodoro ?? DEFAULT_CFG,

  setCfg: (patch) => {
    const next = { ...get().cfg(), ...patch }
    void useSettings.getState().update({ pomodoro: next })
    // 未运行时实时反映到表盘；运行中切换强制开关即时生效
    if (!get().running) set({ remaining: (get().mode === 'work' ? next.focusMin : next.breakMin) * 60 })
    if (patch.force !== undefined && get().running && get().mode === 'work') forceHook(patch.force)
  },

  start: () => {
    ensureTimer()
    if (get().mode === 'work' && get().cfg().force) forceHook(true)
    set({ running: true })
  },
  pause: () => set({ running: false }),
  reset: () => {
    const c = get().cfg()
    set({ running: false, remaining: (get().mode === 'work' ? c.focusMin : c.breakMin) * 60 })
  },
  emergencyStop: () => {
    const c = get().cfg()
    if (c.force) forceHook(false)
    set({ running: false, mode: 'work', remaining: c.focusMin * 60, cur: 1 })
    useUi.getState().toast('已紧急停止番茄钟，强制专注已解除', 'info')
  },

  tick: () => {
    const { running, remaining, mode, cur } = get()
    if (!running) return
    if (remaining > 1) {
      set({ remaining: remaining - 1 })
      return
    }
    const c = get().cfg()
    if (mode === 'work') {
      // 本轮专注完成：记录 + 通知
      const startAt = Date.now() - c.focusMin * 60000
      void useFocus.getState().add({ minutes: c.focusMin, label: '番茄钟', start: startAt, end: Date.now() })
      if (cur >= c.cycles) {
        // 全部轮次完成
        void lh.notify('LearnHub · 番茄钟', `完成 ${c.cycles} 个番茄，本次循环结束 🎉`)
        useUi.getState().toast(`完成 ${c.cycles} 个番茄，太棒了！`, 'ok')
        if (c.force) forceHook(false)
        set({ mode: 'work', remaining: c.focusMin * 60, cur: 1, running: false })
      } else {
        void lh.notify('LearnHub · 番茄钟', `完成第 ${cur} 个番茄！休息 ${c.breakMin} 分钟`)
        useUi.getState().toast(`完成第 ${cur} 个番茄，休息一下`, 'ok')
        // 休息时间放开强制全屏
        if (c.force) forceHook(false)
        set({ mode: 'break', remaining: c.breakMin * 60, running: true })
      }
    } else {
      void lh.notify('LearnHub · 番茄钟', '休息结束，开始新的专注吧')
      useUi.getState().toast('休息结束，继续专注！')
      set({ mode: 'work', remaining: c.focusMin * 60, cur: cur + 1, running: true })
      if (c.force) forceHook(true)
    }
  }
}))

export function fmtRemain(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 二级界面：配置 + 计时 + 紧急停止 */
export function PomodoroDialog() {
  const { mode, running, remaining, cur, uiOpen, setUiOpen, cfg, setCfg, start, pause, reset, emergencyStop } = usePomodoro()
  const c = cfg()
  if (!uiOpen) return null

  const total = (mode === 'work' ? c.focusMin : c.breakMin) * 60
  const pct = total > 0 ? Math.min(100, Math.round(((total - remaining) / total) * 100)) : 0
  const completed = mode === 'work' ? cur - 1 : cur

  const num = (v: string, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(Number(v) || min)))

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onClick={() => setUiOpen(false)}>
      <div className="w-[380px] rounded-xl border border-line bg-bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="mb-3 flex items-center">
          <span className="text-sm font-semibold">番茄钟</span>
          <button className="ml-auto text-txt-dim hover:text-txt" onClick={() => setUiOpen(false)}>
            ×
          </button>
        </div>

        {/* 表盘 */}
        <div className="flex flex-col items-center rounded-xl border border-line bg-bg-soft py-4">
          <div className={`text-4xl font-bold tabular-nums ${mode === 'work' ? 'text-accent' : 'text-green-400'}`}>{fmtRemain(remaining)}</div>
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 ${mode === 'work' ? 'bg-accent/15 text-accent' : 'bg-green-500/15 text-green-400'}`}>
              {mode === 'work' ? '专注中' : '休息中'}
            </span>
            <span className="text-txt-dim">第 {cur} / {c.cycles} 轮 · 已完成 {completed}</span>
            {c.force && running && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-400">{mode === 'work' ? '🔒 强制专注中' : '🔓 强制已放开'}</span>
            )}
          </div>
          <div className="mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-bg">
            <div className={`h-full rounded-full transition-all ${mode === 'work' ? 'bg-accent' : 'bg-green-400'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* 控制区 */}
        <div className="mt-3 flex items-center gap-2">
          {running ? (
            <button className="flex-1 rounded-lg border border-line py-2 text-sm hover:bg-bg-hover" onClick={pause}>
              暂停
            </button>
          ) : (
            <button className="flex-1 rounded-lg bg-accent py-2 text-sm text-white hover:opacity-90" onClick={() => start()}>
              开始
            </button>
          )}
          <button className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-bg-hover" onClick={reset} title="重置当前轮">
            重置
          </button>
          <button
            className="rounded-lg bg-red-500/90 px-4 py-2 text-sm text-white hover:bg-red-500"
            onClick={emergencyStop}
            title="立即结束并解除强制专注"
          >
            紧急停止
          </button>
        </div>

        {/* 配置区 */}
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="text-xs font-medium text-txt-dim">设置（自动保存）</div>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs text-txt-dim">
              专注时长（分钟）
              <input
                type="number"
                min={5}
                max={120}
                className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-txt"
                value={c.focusMin}
                onChange={(e) => setCfg({ focusMin: num(e.target.value, 5, 120) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-txt-dim">
              休息时长（分钟）
              <input
                type="number"
                min={1}
                max={30}
                className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-txt"
                value={c.breakMin}
                onChange={(e) => setCfg({ breakMin: num(e.target.value, 1, 30) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-txt-dim">
              循环次数
              <input
                type="number"
                min={1}
                max={12}
                className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-txt"
                value={c.cycles}
                onChange={(e) => setCfg({ cycles: num(e.target.value, 1, 12) })}
              />
            </label>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-bg-soft p-2.5 text-xs">
            <input type="checkbox" checked={c.force} onChange={(e) => setCfg({ force: e.target.checked })} className="mt-0.5 accent-accent" />
            <span className="flex-1 leading-5">
              <span className="font-medium text-txt">强制专注</span>
              <span className="text-txt-dim">专注时全屏置顶本应用，并拦截 Win 键、Alt+Tab、切换窗口/桌面；休息时间自动放开；Ctrl+Alt+Del 不受影响，随时可「紧急停止」退出。</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}

/** 导航栏悬浮部件（点击时间打开二级界面） */
export function PomodoroWidget() {
  const { mode, running, remaining, cur, setUiOpen, start, pause, reset } = usePomodoro()
  const completed = mode === 'work' ? cur - 1 : cur
  return (
    <>
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-bg-soft px-2.5 py-1 text-xs">
        <button
          className={`font-medium tabular-nums ${mode === 'work' ? 'text-accent hover:opacity-80' : 'text-green-400 hover:opacity-80'}`}
          onClick={() => setUiOpen(true)}
          title="打开番茄钟"
        >
          {mode === 'work' ? '专注' : '休息'} {fmtRemain(remaining)}
        </button>
        <span className="text-txt-dim">
          ×{completed}/{usePomodoro.getState().cfg().cycles}
        </span>
        {running ? (
          <button
            className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-txt-dim hover:border-accent hover:text-accent"
            onClick={pause}
            title="暂停"
          >
            暂停
          </button>
        ) : (
          <button
            className="rounded-md border border-accent/40 px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10"
            onClick={() => start()}
            title="开始"
          >
            开始
          </button>
        )}
        <button
          className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-txt-dim hover:border-accent hover:text-accent"
          onClick={reset}
          title="重置"
        >
          重置
        </button>
      </div>
      <PomodoroDialog />
    </>
  )
}
