import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { registerAllBuiltins } from './components/builtin-modules'
import { useSettings } from './stores/settings'
import { useTodos } from './stores/todos'
import { useSchedule } from './stores/schedule'
import { usePapers } from './stores/papers'
import { useNotes } from './stores/notes'
import { useMindmaps } from './stores/mindmaps'
import { useFlashcards } from './stores/flashcards'
import { useFocus, useModuleEvents } from './stores/misc'
import { useRegistry } from './kernel/registry'
import { initSearchEvents, loadSearchAssets, pruneSearchHistory } from './stores/search'
import { startAutoSync } from './lib/sync'

async function boot(): Promise<void> {
  // 1. 注册内置模块清单（含 meta-core 元模块）
  registerAllBuiltins()
  // 2. 设置（含 moduleState 启停状态）
  await useSettings.getState().load()
  // 3. 外部模块与授权记录
  await useRegistry.getState().load()
  // 4. 业务数据
  await Promise.all([
    useTodos.getState().load(),
    useSchedule.getState().load(),
    usePapers.getState().load(),
    useNotes.getState().load(),
    useMindmaps.getState().load(),
    useFlashcards.getState().load(),
    useFocus.getState().load(),
    useModuleEvents.getState().load()
  ])
  // 5. 搜索链路事件（论文选区 → 宽侧栏；继续搜索 → 主界面）与 webview 资源
  initSearchEvents()
  await loadSearchAssets() // 必须在渲染前完成：webview 首次挂载就要带上 preload，否则选中/右键事件全程失效
  // 6. 清理孤儿搜索历史（旧格式 / 链路节点已删除）
  pruneSearchHistory()
  // 7. GitHub 自动同步循环（间隔在设置页配置）
  startAutoSync()
  createRoot(document.getElementById('root')!).render(<App />)
}

void boot()
