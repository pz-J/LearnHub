import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // ---------- data/ 学习数据 ----------
  dataRead: (rel: string) => ipcRenderer.invoke('data:read', rel),
  dataWrite: (rel: string, content: unknown) => ipcRenderer.invoke('data:write', rel, content),
  dataDelete: (rel: string) => ipcRenderer.invoke('data:delete', rel),
  dataList: (relDir: string) => ipcRenderer.invoke('data:list', relDir),

  // ---------- settings / grants / 模块存储 / 同步状态 ----------
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  grantsGet: () => ipcRenderer.invoke('grants:get'),
  grantsSet: (obj: unknown) => ipcRenderer.invoke('grants:set', obj),
  modStorageRead: (id: string) => ipcRenderer.invoke('modstore:read', id),
  modStorageListAll: () => ipcRenderer.invoke('modstore:listAll'),
  modStorageWrite: (id: string, obj: unknown) => ipcRenderer.invoke('modstore:write', id, obj),
  syncStateGet: () => ipcRenderer.invoke('syncstate:get'),
  syncStateSet: (obj: unknown) => ipcRenderer.invoke('syncstate:set', obj),

  // ---------- PDF 文件 ----------
  pdfPickImport: () => ipcRenderer.invoke('pdf:pickImport'),
  pdfRead: (id: string) => ipcRenderer.invoke('pdf:read', id),
  pdfDelete: (id: string) => ipcRenderer.invoke('pdf:delete', id),
  fileSaveText: (defaultName: string, content: string) =>
    ipcRenderer.invoke('file:saveText', defaultName, content),
  fileOpenText: (filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('file:openText', filters),

  // ---------- AI（事件流） ----------
  aiChat: (req: unknown) => ipcRenderer.invoke('ai:chat', req),
  aiAbort: (id: string) => ipcRenderer.invoke('ai:abort', id),
  onAiChunk: (cb: (p: { id: string; delta: string }) => void) => {
    const l = (_e: unknown, p: { id: string; delta: string }) => cb(p)
    ipcRenderer.on('ai:chunk', l)
    return () => ipcRenderer.removeListener('ai:chunk', l)
  },
  onAiDone: (cb: (p: { id: string; aborted?: boolean }) => void) => {
    const l = (_e: unknown, p: { id: string; aborted?: boolean }) => cb(p)
    ipcRenderer.on('ai:done', l)
    return () => ipcRenderer.removeListener('ai:done', l)
  },
  onAiError: (cb: (p: { id: string; message: string }) => void) => {
    const l = (_e: unknown, p: { id: string; message: string }) => cb(p)
    ipcRenderer.on('ai:error', l)
    return () => ipcRenderer.removeListener('ai:error', l)
  },

  // ---------- GitHub ----------
  ghGetUser: (pat: string) => ipcRenderer.invoke('gh:getUser', pat),
  ghSync: (req: unknown) => ipcRenderer.invoke('gh:sync', req),

  // ---------- 外部模块 ----------
  modulesPick: () => ipcRenderer.invoke('modules:pick'),
  modulesPickBatch: () => ipcRenderer.invoke('modules:pick-batch'),
  modulesList: () => ipcRenderer.invoke('modules:list'),
  modulesInstall: (id: string, files: Record<string, string>) =>
    ipcRenderer.invoke('modules:install', id, files),
  modulesUninstall: (id: string) => ipcRenderer.invoke('modules:uninstall', id),
  moduleOpenExternal: (moduleId: string, url: string) => ipcRenderer.invoke('module:openExternal', moduleId, url),

  // ---------- 其他 ----------
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  openModStorageDir: () => ipcRenderer.invoke('app:openModStorageDir'),
  clipboardWrite: (text: string) => ipcRenderer.invoke('app:clipboardWrite', text),
  notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', title, body),
  /** 番茄钟强制专注：全屏置顶 + 底层键盘钩子（Win/Alt+Tab/Alt+Esc/Ctrl+Esc）。hooked=false 表示钩子不可用（仅全屏置顶） */
  pomForce: (on: boolean) => ipcRenderer.invoke('pom:force', on) as Promise<{ hooked: boolean }>,
  /** webview 内右键（主进程转发）：文字 + webview 内坐标 */
  onWebCtx: (cb: (p: { text: string; x: number; y: number }) => void) => {
    const l = (_e: unknown, p: { text: string; x: number; y: number }) => cb(p)
    ipcRenderer.on('search:webctx', l)
    return () => {
      ipcRenderer.removeListener('search:webctx', l)
    }
  },
  versions: () => ipcRenderer.invoke('app:versions'),
  webviewPreload: () => ipcRenderer.invoke('app:webviewPreload') as Promise<string>
}

export type LhApi = typeof api

contextBridge.exposeInMainWorld('lh', api)
