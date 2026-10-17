import { secureHandle } from './ipcSecurity'
import { app, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { filesDir, safeJoin, sanitizeId } from './store'
import { assertNoSymlinkComponents } from './securityValidation'

export function registerFilesIpc(): void {
  secureHandle('pdf:pickImport', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择论文 PDF',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths.length) return null
    const src = r.filePaths[0]
    const id = 'p_' + randomUUID().replace(/-/g, '').slice(0, 16)
    const dest = safeJoin(filesDir(), id + '.pdf')
    assertNoSymlinkComponents(app.getPath('userData'), dest)
    fs.mkdirSync(filesDir(), { recursive: true })
    assertNoSymlinkComponents(app.getPath('userData'), dest)
    fs.copyFileSync(src, dest)
    return { id, fileName: path.basename(src) }
  })

  secureHandle('pdf:read', (_e, id: string) => {
    const file = safeJoin(filesDir(), sanitizeId(id) + '.pdf')
    assertNoSymlinkComponents(app.getPath('userData'), file)
    const buf = fs.readFileSync(file)
    // 返回 ArrayBuffer 副本（避免 Buffer 池偏移问题）
    const ab = new ArrayBuffer(buf.byteLength)
    new Uint8Array(ab).set(buf)
    return ab
  })

  secureHandle('pdf:delete', (_e, id: string) => {
    const file = safeJoin(filesDir(), sanitizeId(id) + '.pdf')
    assertNoSymlinkComponents(app.getPath('userData'), file)
    if (fs.existsSync(file)) fs.rmSync(file)
    return true
  })

  // 供模块保存文本文件（BibTeX、导出等）
  secureHandle('file:saveText', async (e, defaultName: string, content: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showSaveDialog(win as BrowserWindow, {
      title: '保存文件',
      defaultPath: defaultName
    })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, content, 'utf-8')
    return r.filePath
  })

  // 供模块读取文本文件
  secureHandle('file:openText', async (e, filters?: { name: string; extensions: string[] }[]) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择文件',
      filters: filters ?? [{ name: '文本', extensions: ['txt', 'md', 'json', 'bib', 'csv'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths.length) return null
    const p = r.filePaths[0]
    if (fs.statSync(p).size > 5 * 1024 * 1024) return { error: '文件过大' }
    return { fileName: path.basename(p), content: fs.readFileSync(p, 'utf-8') }
  })
}
