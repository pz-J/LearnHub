/** 权限目录（Capability Catalog）—— 宿主内核写死，模块必须声明才能使用 */

export type Capability =
  | 'storage.own'
  | 'storage.data'
  | 'files.pick'
  | 'pdf.read'
  | 'network.fetch'
  | 'ai.invoke'
  | 'calendar.write'
  | 'reader.annotate'
  | 'ui.panel'
  | 'ui.theme'
  | 'clipboard'
  | 'notify'
  | 'links.open'
  | 'meta.escalate'
  | 'achievements.award'

export interface CapabilityInfo {
  desc: string
  level: 'normal' | 'sensitive' | 'danger'
  metaOnly?: boolean
}

export const CATALOG: Record<Capability, CapabilityInfo> = {
  'storage.own': { desc: '模块私有存储（读写本模块专属数据）', level: 'normal' },
  'storage.data': { desc: '读写学习数据（待办/课表/笔记/闪卡）', level: 'normal' },
  'files.pick': { desc: '文件对话框（选择与保存文件）', level: 'normal' },
  'pdf.read': { desc: '读取论文 PDF 内容', level: 'normal' },
  'network.fetch': { desc: '按清单域名白名单发起网络请求', level: 'normal' },
  'ai.invoke': { desc: '调用用户配置的 AI 模型', level: 'normal' },
  'calendar.write': { desc: '写入日历事件', level: 'normal' },
  'reader.annotate': { desc: '读写高亮批注、注册选区工具条按钮', level: 'normal' },
  'ui.panel': { desc: '注册面板/导航入口/悬浮部件', level: 'normal' },
  'ui.theme': { desc: '读取并调整界面主题（强调色、圆角、界面缩放）', level: 'normal' },
  clipboard: { desc: '读写剪贴板', level: 'normal' },
  notify: { desc: '发送系统通知', level: 'normal' },
  'links.open': { desc: '经用户点击后在默认浏览器中打开 HTTPS 链接', level: 'sensitive' },
  'meta.escalate': { desc: '代其他模块申请宿主已实现的可选权限', level: 'danger', metaOnly: true },
  'achievements.award': { desc: '向成就系统登记已完成任务（由用户领取积木奖励）', level: 'normal' }
}

export const LEVEL_LABEL: Record<CapabilityInfo['level'], string> = {
  normal: '普通',
  sensitive: '敏感',
  danger: '高危'
}

export function isCapability(s: string): s is Capability {
  return Object.prototype.hasOwnProperty.call(CATALOG, s)
}
