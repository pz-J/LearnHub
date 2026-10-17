import { lh } from '@/lib/ipc'
import { eventBus } from '@/kernel/eventBus'
import { useUi } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { useTodos } from '@/stores/todos'
import { useSchedule } from '@/stores/schedule'
import { usePapers } from '@/stores/papers'
import { useNotes } from '@/stores/notes'
import { useMindmaps } from '@/stores/mindmaps'
import { useFlashcards } from '@/stores/flashcards'
import { useFocus, useModuleEvents } from '@/stores/misc'

interface SyncFileEntry {
  path: string
  content: string
}

export interface SyncSummary {
  ok: boolean
  pushed: number
  pulled: number
  conflicts: number
  error?: string
  repoCreated?: boolean
}

interface GhReport {
  ok: boolean
  error?: string
  repoCreated?: boolean
  pulled: { path: string; content: string }[]
  actions: { action: string; path: string }[]
  state: Record<string, { remoteSha: string; localHash: string }>
}

/** 收集 data/ 下全部同步文件 */
export async function collectDataFiles(): Promise<SyncFileEntry[]> {
  const out: SyncFileEntry[] = []
  const readJson = async (rel: string): Promise<unknown | null> => lh.dataRead(rel)
  const addJson = async (rel: string) => {
    const v = await readJson(rel)
    if (v) out.push({ path: rel, content: JSON.stringify(v, null, 2) })
  }
  for (const f of ['todos.json', 'schedule.json', 'flashcards.json', 'module-events.json', 'focus-log.json', 'achievements.json', 'tower.json']) {
    await addJson(f)
  }
  for (const dir of ['papers', 'mindmaps']) {
    const files = await lh.dataList(dir)
    for (const f of files) if (f.endsWith('.json')) await addJson(`${dir}/${f}`)
  }
  const notes = await lh.dataList('notes')
  for (const f of notes) {
    if (!f.endsWith('.md')) continue
    const raw = (await lh.dataRead(`notes/${f}`)) as string | null
    if (raw != null) out.push({ path: `notes/${f}`, content: raw })
  }
  // 模块私有存储打包成单文件同步（module-storage.json）：克制上传，不逐模块开文件
  const modStores = (await lh.modStorageListAll()) as { id: string; obj: Record<string, unknown> }[]
  if (modStores.length) {
    const bundle: Record<string, unknown> = {}
    for (const m of modStores) bundle[m.id] = m.obj
    out.push({ path: 'module-storage.json', content: JSON.stringify({ updatedAt: Date.now(), modules: bundle }, null, 2) })
  }
  return out
}

/** 一键同步：拉取远端变更 + 推送本地变更（文件级，时间戳裁决冲突） */
export async function syncNow(opts?: { quiet?: boolean }): Promise<SyncSummary> {
  const { github } = useSettings.getState().settings
  if (!github.pat || !github.owner || !github.repo) {
    recordSync({ ok: false, pushed: 0, pulled: 0, conflicts: 0, error: '未配置 GitHub' })
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, error: '请先在「设置」中配置 GitHub PAT、用户名与仓库名' }
  }
  const state = ((await lh.syncStateGet()) as Record<string, { remoteSha: string; localHash: string }>) ?? {}
  const files = await collectDataFiles()
  const report = (await lh.ghSync({
    pat: github.pat,
    owner: github.owner,
    repo: github.repo,
    branch: 'main',
    files,
    state
  })) as GhReport
  if (!report.ok) {
    const fail: SyncSummary = { ok: false, pushed: 0, pulled: 0, conflicts: 0, error: report.error, repoCreated: report.repoCreated }
    recordSync(fail)
    return fail
  }
  // 应用拉取的远端内容
  for (const f of report.pulled) {
    if (f.path === 'module-storage.json') {
      // 模块存储包：整体写回各模块私有存储（data:write 仅限 data/ 目录，走 modstore 通道）
      try {
        const bundle = JSON.parse(typeof f.content === 'string' ? f.content : 'null') as { modules?: Record<string, unknown> } | null
        const mods = bundle?.modules
        if (mods && typeof mods === 'object' && !Array.isArray(mods)) {
          for (const [id, obj] of Object.entries(mods)) {
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) await lh.modStorageWrite(id, obj)
          }
        }
      } catch {
        /* 跳过无效的模块存储包 */
      }
    } else {
      await lh.dataWrite(f.path, f.content)
    }
  }
  await lh.syncStateSet(report.state)
  if (report.pulled.length) {
    // 重新加载受影响的数据
    await reloadAfterPull(
      report.pulled.map((p) => p.path),
      opts?.quiet
    )
  }
  const pushed = report.actions.filter((a) => a.action === 'pushed').length
  const conflicts = report.actions.filter((a) => a.action.startsWith('conflict')).length
  const summary: SyncSummary = {
    ok: true,
    pushed,
    pulled: report.pulled.length,
    conflicts,
    repoCreated: report.repoCreated
  }
  recordSync(summary)
  eventBus.emit('sync:done', { pushed, pulled: report.pulled.length, conflicts })
  return summary
}

/** 把最近一次同步结果写入设置（设置页展示同步状态） */
function recordSync(s: SyncSummary): void {
  void useSettings.getState().update({
    syncState: { lastAt: Date.now(), ok: s.ok, pushed: s.pushed, pulled: s.pulled, conflicts: s.conflicts, error: s.error }
  })
}

// ---------- 自动同步（git 同步支柱：默认关闭，设置页可开启 5/15/30 分钟间隔） ----------
let autoTimer: ReturnType<typeof setTimeout> | null = null
let autoRunning = false

async function autoTick(): Promise<void> {
  const { github } = useSettings.getState().settings
  const gap = Math.max(0, Number(github.autoSync ?? 0))
  if (gap > 0 && github.pat && github.owner && github.repo && !autoRunning) {
    autoRunning = true
    try {
      await syncNow({ quiet: true })
    } catch {
      // 自动同步失败不打断循环，状态已记录进设置页
    }
    autoRunning = false
  }
  scheduleNext(gap)
}

function scheduleNext(gap: number): void {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = null
  const wait = (gap > 0 ? gap : 1) * 60_000
  autoTimer = setTimeout(() => void autoTick(), wait)
}

/** 应用启动时调用一次；之后按设置的间隔自动同步，修改设置即时生效 */
export function startAutoSync(): void {
  const { github } = useSettings.getState().settings
  scheduleNext(Math.max(0, Number(github.autoSync ?? 0)))
  // 启动 30 秒后先做一次（若已配置），让多设备尽快收敛
  setTimeout(() => void autoTick(), 30_000)
}

async function reloadAfterPull(paths: string[], quiet?: boolean): Promise<void> {
  const stores = {
    todos: useTodos.getState,
    schedule: useSchedule.getState,
    papers: usePapers.getState,
    notes: useNotes.getState,
    mindmaps: useMindmaps.getState,
    flashcards: useFlashcards.getState,
    focus: useFocus.getState,
    moduleEvents: useModuleEvents.getState
  }
  await Promise.all(Object.values(stores).map(async (s) => s().load()))
  if (!quiet) useUi.getState().toast(`同步完成：拉取 ${paths.length} 个文件并已重载`, 'ok')
}
