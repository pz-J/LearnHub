import { secureHandle } from './ipcSecurity'
/**
 * 番茄钟强制专注服务：
 *  - 全屏 + 置顶（screen-saver 级，盖住任务栏）
 *  - 独立 worker 线程装 WH_KEYBOARD_LL 钩子拦截 Win / Alt+Tab / Alt+Esc / Ctrl+Esc
 *  - 强制期间拦截窗口关闭（紧急停止是唯一应用内出口；Ctrl+Alt+Del 系统级保留）
 */
import { Worker } from 'node:worker_threads'
import { join } from 'path'
import { BrowserWindow } from 'electron'

let win: BrowserWindow | null = null
let worker: Worker | null = null
let hooked = false
let forced = false
let readyP: Promise<boolean> | null = null

export function isForced(): boolean {
  return forced
}

function ensureWorker(): Worker | null {
  if (worker) return worker
  try {
    const w = new Worker(join(__dirname, 'forceFocusWorker.js'))
    readyP = new Promise<boolean>((resolve) => {
      const onMsg = (m: { ok?: boolean }): void => {
        w.off('message', onMsg)
        resolve(!!m?.ok)
      }
      w.once('message', onMsg)
      setTimeout(() => {
        w.off('message', onMsg)
        resolve(false)
      }, 1500)
    })
    w.on('message', (m: { ok?: boolean }) => {
      if (typeof m?.ok === 'boolean') hooked = m.ok
    })
    w.on('error', () => {
      hooked = false
    })
    w.once('exit', () => {
      worker = null
      hooked = false
    })
    worker = w
  } catch {
    hooked = false
  }
  return worker
}

/** 应用/解除强制专注。返回 hooked 表示键盘钩子是否可用（不可用时仅全屏置顶） */
export function applyForce(on: boolean): { hooked: boolean } {
  forced = on
  const w = win && !win.isDestroyed() ? win : null
  if (w) {
    if (on) {
      if (!w.isFullScreen()) w.setFullScreen(true)
      w.setAlwaysOnTop(true, 'screen-saver')
      w.setMenuBarVisibility(false)
      w.focus()
    } else {
      w.setAlwaysOnTop(false)
      if (w.isFullScreen()) w.setFullScreen(false)
      w.setMenuBarVisibility(true)
    }
  }
  if (on) {
    ensureWorker()?.postMessage({ on: true })
    return { hooked }
  }
  // 解除：终止 worker 即释放系统钩子
  if (worker) {
    worker.postMessage({ on: false })
    void worker.terminate()
    worker = null
    readyP = null
  }
  hooked = false
  return { hooked: false }
}

export function registerPomForceIpc(getWin: () => BrowserWindow | null): void {
  win = getWin()
  secureHandle('pom:force', async (_e, on: boolean) => {
    const r = applyForce(!!on)
    if (on && readyP) r.hooked = await readyP // 首次启动 worker 时等初始化结果
    return { hooked: r.hooked }
  })
}
