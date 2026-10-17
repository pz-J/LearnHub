import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { useRegistry } from '@/kernel/registry'
import type { ModuleManifest } from '@/kernel/manifest'

type RegisteredComponent = ComponentType | LazyExoticComponent<ComponentType>
const FlashcardsModule = lazy(() => import('./flashcards/FlashcardsModule').then((m) => ({ default: m.FlashcardsModule })))
const StatsModule = lazy(() => import('./stats/StatsModule').then((m) => ({ default: m.StatsModule })))
const TranslateModule = lazy(() => import('./translate/TranslateModule').then((m) => ({ default: m.TranslateModule })))
const LitmanModule = lazy(() => import('./litman/LitmanModule').then((m) => ({ default: m.LitmanModule })))
const ScheduleModuleView = lazy(() => import('./schedule/ScheduleModuleView').then((m) => ({ default: m.ScheduleModuleView })))
const AchievementsModule = lazy(() => import('./achievements/AchievementsModule').then((m) => ({ default: m.AchievementsModule })))

/** 内置子模块清单（宿主随应用注册，不可卸载、可在模块中心停用） */
export const BUILTIN_MANIFESTS: ModuleManifest[] = [
  {
    id: 'core.meta',
    name: '元模块核心',
    version: '1.0.0',
    type: 'meta',
    entry: 'index.js',
    description: '内置审批代理（meta-core）：受理子模块的权限升级申请并向用户转达二次确认；元模块开发者经 meta.* API 使用同一通道',
    permissions: ['meta.escalate', 'meta.bridge'],
    contributes: {}
  },
  {
    id: 'core.calendar',
    name: '日历待办',
    version: '1.0.0',
    type: 'feature',
    entry: 'index.js',
    description: '日历视图待办管理，课表与待办同步显示',
    permissions: ['storage.data', 'calendar.write', 'ui.panel'],
    contributes: {}
  },
  {
    id: 'core.schedule',
    name: '课表',
    version: '1.0.0',
    type: 'feature',
    entry: 'index.js',
    description: '学期课表管理：PDF 导入、每节时长与课间自由调整、周次划分；课程与日历菜单项同步显示',
    permissions: ['storage.data', 'calendar.write', 'files.pick', 'pdf.read', 'ai.invoke'],
    contributes: { routes: [{ key: 'schedule', title: '课表' }] }
  },
  {
    id: 'core.flashcards',
    name: '闪卡复习',
    version: '1.0.0',
    type: 'feature',
    entry: 'index.js',
    description: 'SM-2 间隔复习，支持从论文高亮一键建卡与 AI 生成答案',
    permissions: ['storage.data', 'ai.invoke'],
    contributes: { routes: [{ key: 'flashcards', title: '闪卡' }] }
  },
  {
    id: 'core.pomodoro',
    name: '番茄钟',
    version: '1.0.0',
    type: 'feature',
    entry: 'index.js',
    description: '25/5 番茄专注，完成自动记录学习统计并发送系统通知',
    permissions: ['notify'],
    contributes: {}
  },
  {
    id: 'core.translate',
    name: '划词翻译',
    version: '1.0.0',
    type: 'feature',
    entry: 'index.js',
    description: '阅读器选中即译，AI 流式翻译，中英互转',
    permissions: ['ai.invoke', 'reader.annotate', 'ui.panel'],
    contributes: { panels: [{ slot: 'sidebar', title: '翻译' }] }
  },
  {
    id: 'core.stats',
    name: '学习统计',
    version: '1.0.0',
    type: 'feature',
    entry: 'index.js',
    description: '专注时长、待办完成、闪卡与文献数据概览',
    permissions: ['storage.data', 'ui.panel'],
    contributes: { routes: [{ key: 'stats', title: '统计' }] }
  },
  {
    id: 'core.achievements',
    name: '成就大楼',
    version: '1.0.0',
    type: 'feature',
    entry: 'index.js',
    description: '学习成就与积木大楼：读论文、专注、待办与自定义任务完成可领取积木，拼起自己的学习大楼；外部模块经 achievements.award 也可发布任务奖励',
    permissions: ['storage.data', 'ui.panel'],
    contributes: { routes: [{ key: 'achievements', title: '成就' }] }
  },
  {
    id: 'core.litman',
    name: '文献助手',
    version: '1.0.0',
    type: 'feature',
    entry: 'index.js',
    description: 'CrossRef 元数据检索、BibTeX 导出、AI 论文总结',
    permissions: ['network.fetch', 'ai.invoke', 'clipboard', 'files.pick', 'ui.panel'],
    optionalPermissions: ['reader.annotate'],
    network: { allowedHosts: ['api.crossref.org'] },
    contributes: { panels: [{ slot: 'sidebar', title: '文献助手' }] }
  }
]

/** 注册全部内置模块清单（应用启动时调用一次） */
export function registerAllBuiltins(): void {
  for (const issue of builtinRegistryIssues()) console.error(`[LearnHub module registry] ${issue}`)
  for (const m of BUILTIN_MANIFESTS) useRegistry.getState().registerBuiltin(m)
}

/** 内置模块路由组件映射（App 渲染 mod:id:key 路由时使用，键与 moduleRoutes() 的 mod: 前缀一致） */
export const BUILTIN_ROUTE_COMPONENTS: Record<string, RegisteredComponent> = {
  'mod:core.flashcards:flashcards': FlashcardsModule,
  'mod:core.stats:stats': StatsModule,
  'mod:core.schedule:schedule': ScheduleModuleView,
  'mod:core.achievements:achievements': AchievementsModule
}

/** 内置模块侧边栏面板组件映射（SidebarHost 渲染时使用） */
export const BUILTIN_PANEL_COMPONENTS: Record<string, RegisteredComponent> = {
  'core.translate:panel': TranslateModule,
  'core.litman:panel': LitmanModule
}

/** Keep manifest contributions and React component bindings in sync at startup. */
export function builtinRegistryIssues(): string[] {
  const declaredRoutes = new Set<string>()
  const declaredPanels = new Set<string>()
  for (const manifest of BUILTIN_MANIFESTS) {
    for (const route of manifest.contributes?.routes ?? []) declaredRoutes.add(`mod:${manifest.id}:${route.key}`)
    for (const _panel of manifest.contributes?.panels ?? []) declaredPanels.add(`${manifest.id}:panel`)
  }
  const issues: string[] = []
  for (const key of declaredRoutes) if (!BUILTIN_ROUTE_COMPONENTS[key]) issues.push(`内置路由缺少组件映射：${key}`)
  for (const key of declaredPanels) if (!BUILTIN_PANEL_COMPONENTS[key]) issues.push(`内置面板缺少组件映射：${key}`)
  for (const key of Object.keys(BUILTIN_ROUTE_COMPONENTS)) if (!declaredRoutes.has(key)) issues.push(`内置路由组件没有清单声明：${key}`)
  for (const key of Object.keys(BUILTIN_PANEL_COMPONENTS)) if (!declaredPanels.has(key)) issues.push(`内置面板组件没有清单声明：${key}`)
  return issues
}
