import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { isTrustedRendererUrl } from './securityValidation'

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown

/** Register an IPC handler reachable only from LearnHub's top-level renderer.
 * Sandboxed webviews and arbitrary navigated frames must never call privileged IPC.
 */
export function secureHandle(channel: string, handler: InvokeHandler): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedRenderer(event)
    return handler(event, ...args)
  })
}

export function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame || !isTrustedRendererUrl(frame.url, process.env.ELECTRON_RENDERER_URL, join(__dirname, '../renderer/index.html'))) {
    throw new Error('拒绝来自非 LearnHub 主页面的 IPC 请求')
  }
}
