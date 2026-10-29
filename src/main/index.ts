import { secureHandle } from './services/ipcSecurity'
import { app, BrowserWindow, Menu, dialog } from 'electron'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { registerStoreIpc } from './services/store'
import { registerFilesIpc } from './services/files'
import { registerAiIpc } from './services/aiProxy'
import { registerGithubIpc } from './services/githubSync'
import { registerMiscIpc } from './services/misc'
import { registerModulesIpc } from './services/modules'
import { registerPomForceIpc, isForced } from './services/forceFocus'
import { isTrustedRendererUrl } from './services/securityValidation'

// Explicit, development-only override for isolated desktop QA. Normal launches keep Electron's default userData path.
const qaUserDataDir = process.env.LEARNHUB_QA_USER_DATA_DIR
if (qaUserDataDir && !app.isPackaged) app.setPath('userData', resolve(qaUserDataDir))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    title: 'LearnHub · 集成学习中心',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
      spellcheck: false
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, process.env.ELECTRON_RENDERER_URL, join(__dirname, '../renderer/index.html'))) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!/^file:\/\/.+\/preload\/webview\.js(?:\?.*)?$/i.test(String(params.preload ?? webPreferences.preload ?? ''))) {
      event.preventDefault()
      return
    }
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.nodeIntegrationInSubFrames = false
  })

  win.on('ready-to-show', () => win.show())
  // 强制专注期间拦截关闭（应用内「紧急停止」是唯一出口；Ctrl+Alt+Del 系统级保留）
  win.on('close', (e) => {
    if (isForced()) {
      e.preventDefault()
      void dialog.showMessageBox(win, {
        type: 'warning',
        title: 'LearnHub · 强制专注中',
        message: '番茄钟强制专注进行中，暂不能关闭应用。',
        detail: '请回到番茄钟界面点击「紧急停止」结束本次专注。'
      })
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

let mainWindow: BrowserWindow | null = null

/** webview 内点击链接（target=_blank / window.open）不弹出独立窗口，而是在原 webview 内打开，保持一体式体验 */
app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'webview') return
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void wc.loadURL(url)
    return { action: 'deny' }
  })
  // webview 内右键：拦截默认菜单，转发宿主渲染进程弹快捷菜单（主进程路径，不依赖 preload）
  wc.on('context-menu', (ev, params) => {
    // 无选中文字但点在链接上 → 保留原生菜单（复制链接地址等）
    if (!params.selectionText.trim() && params.linkURL) return
    ev.preventDefault()
    const win = mainWindow ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send('search:webctx', { text: params.selectionText.slice(0, 500), x: params.x, y: params.y })
  })
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  const win = createWindow()
  mainWindow = win

  const getWin = () => mainWindow ?? BrowserWindow.getAllWindows()[0]
  registerStoreIpc()
  registerFilesIpc()
  registerAiIpc(getWin)
  registerGithubIpc()
  registerMiscIpc()
  registerModulesIpc()
  registerPomForceIpc(getWin)

  /** 内嵌 webview 的 preload 绝对路径（搜索面板选中文字上报用） */
  secureHandle('app:webviewPreload', () => pathToFileURL(join(__dirname, '../preload/webview.js')).href)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
