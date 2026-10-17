/** 内嵌 webview 的 preload：把页面内选中文字上报给宿主（搜索链路二级搜索用） */
import { ipcRenderer } from 'electron'

let last = ''

function sendSelection(): void {
  const t = (window.getSelection()?.toString() ?? '').trim()
  if (t) {
    if (t !== last) {
      last = t
      ipcRenderer.sendToHost('lh:selection', t.slice(0, 500))
    }
  } else {
    last = ''
  }
}

// mouseup 上报（主流方式）
document.addEventListener('mouseup', () => setTimeout(sendSelection, 0), true)

// 兜底：部分页面（iframe/动态渲染）mouseup 不触发，监听选区变化（250ms 防抖）
let selTimer: ReturnType<typeof setTimeout> | null = null
document.addEventListener(
  'selectionchange',
  () => {
    if (selTimer) clearTimeout(selTimer)
    selTimer = setTimeout(sendSelection, 250)
  },
  true
)

// 右键：选中文字时拦截默认菜单，把文字 + 坐标交给宿主弹快捷菜单（搜索/解释）
document.addEventListener(
  'contextmenu',
  (e) => {
    const t = (window.getSelection()?.toString() ?? '').trim()
    if (!t) return // 无选中 → 保留网页默认菜单
    e.preventDefault()
    ipcRenderer.sendToHost('lh:selctx', { text: t.slice(0, 500), x: e.clientX, y: e.clientY })
  },
  true
)
