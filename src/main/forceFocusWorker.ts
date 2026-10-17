/**
 * 强制专注底层键盘钩子 worker（独立线程，自带消息泵）。
 * 通过 koffi 调用 user32 的 SetWindowsHookExW(WH_KEYBOARD_LL)：
 *  - 拦截 Win 键（含 Win+D 显示桌面、Win+Tab 任务视图、Win+Ctrl+←/→ 切换虚拟桌面）
 *  - 拦截 Alt+Tab（切换窗口）、Alt+Esc、Ctrl+Esc
 * Ctrl+Alt+Del 属于系统级中断，无法也不应拦截 —— 作为最终逃生通道保留。
 */
import { parentPort } from 'node:worker_threads'

let active = false

function main(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const koffi = require('koffi') as {
    load: (name: string) => {
      func: (ret: string, name: string, args: string[]) => (...a: unknown[]) => unknown
    }
    proto: (name: string, ret: string, args: string[]) => unknown
    register: (proto: unknown, cb: (...a: unknown[]) => unknown) => unknown
  }

  const user32 = koffi.load('user32.dll')
  const SetWindowsHookExW = user32.func('intptr', 'SetWindowsHookExW', ['int', 'void *', 'intptr', 'uint32'])
  const CallNextHookEx = user32.func('intptr', 'CallNextHookEx', ['intptr', 'int', 'uintptr', 'intptr'])
  const GetModuleHandleW = user32.func('intptr', 'GetModuleHandleW', ['void *'])
  const GetMessageW = user32.func('int', 'GetMessageW', ['void *', 'void *', 'uint32', 'uint32'])
  const GetAsyncKeyState = user32.func('short', 'GetAsyncKeyState', ['int'])

  const WH_KEYBOARD_LL = 13
  const VK_TAB = 0x09
  const VK_ESCAPE = 0x1b
  const VK_CONTROL = 0x11
  const VK_MENU = 0x12 // Alt
  const VK_LWIN = 0x5b
  const VK_RWIN = 0x5c

  const proto = koffi.proto('LLKeyboardProc', 'intptr', ['int', 'uintptr', 'intptr'])
  const down = (key: number) => ((GetAsyncKeyState(key) as number) & 0x8000) !== 0

  const proc = koffi.register(proto, (...args: unknown[]) => {
    const [nCode, wParam, lParam] = args as [number, number | bigint, number | bigint]
    if (nCode >= 0 && active) {
      const vk = Number(wParam)
      // Win 键 → 连带封掉 Win+D / Win+Tab / Win+Ctrl+←/→ 等全部组合
      if (vk === VK_LWIN || vk === VK_RWIN) return 1
      if (vk === VK_TAB && down(VK_MENU)) return 1 // Alt+Tab
      if (vk === VK_ESCAPE && (down(VK_MENU) || down(VK_CONTROL))) return 1 // Alt+Esc / Ctrl+Esc
    }
    return CallNextHookEx(null, nCode, wParam, lParam)
  })

  const hook = SetWindowsHookExW(WH_KEYBOARD_LL, proc, GetModuleHandleW(null), 0)
  if (!hook) throw new Error('SetWindowsHookExW 安装失败')

  parentPort?.on('message', (m: { on?: boolean }) => {
    if (typeof m?.on === 'boolean') active = m.on
  })
  parentPort?.postMessage({ ok: true, error: null })

  // LL 钩子要求安装线程持续泵消息；GetMessageW 阻塞循环即维持 worker 存活
  while ((GetMessageW(null, null, 0, 0) as number) > 0) {
    /* pump */
  }
}

try {
  main()
} catch (e) {
  parentPort?.postMessage({ ok: false, error: String(e) })
}
