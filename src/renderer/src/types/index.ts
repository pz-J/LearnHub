/** LearnHub 共享数据类型 */

export interface Todo {
  id: string
  title: string
  date: string // YYYY-MM-DD
  time?: string // HH:mm
  priority: 'low' | 'mid' | 'high'
  done: boolean
  repeat: 'none' | 'daily' | 'weekly'
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface Period {
  n: number
  start: string // HH:mm
  end: string
}

export interface Course {
  id: string
  name: string
  teacher?: string
  room?: string
  day: number // 1=周一 ... 7=周日
  startPeriod: number
  endPeriod: number
  weeksText?: string // 如 "1-16周" / "1-8,10-16周"
  color: string
}

export interface Schedule {
  semesterStart: string // 学期第一周周一 YYYY-MM-DD
  periods: Period[]
  courses: Course[]
  updatedAt: number
}

export interface Highlight {
  id: string
  page: number
  rects: { x: number; y: number; w: number; h: number }[] // 归一化 0~1（相对页面）
  text: string
  color: string
  note?: string
  aiExplain?: string
  isAuto?: boolean // 同文本自动同步的标记（非用户手动）
  createdAt: number
}

export interface SearchRecord {
  id: string
  query: string
  provider: string // bing | baidu | google | scholar
  sourceHighlightId?: string
  boundText?: string // 与之绑定的原文片段
  mapId?: string // 所属搜索链路（导图）
  nodeId?: string // 所属链路节点（用于历史合并与清理：节点删/改时同步清理记录）
  createdAt: number
}

/** 搜索中收为「答案」的文字：折叠到链路根问题下方（论文笔记视图展示） */
export interface PaperAnswer {
  id: string
  mapId: string
  nodeId: string // 所属链路的根节点
  question: string // 最开始搜索的内容
  quote: string // 收为答案的选中文本
  source?: string // 来源 URL
  createdAt: number
}

export interface PaperMeta {
  doi: string
  authors: string
  year: string
  venue: string
  bibtex?: string
}

export interface Paper {
  id: string
  title: string
  fileName: string
  tags: string[]
  course: string
  meta: PaperMeta
  highlights: Highlight[]
  searches: SearchRecord[]
  answers?: PaperAnswer[]
  /** 成就系统：用户标记为已读完 */
  finished?: boolean
  createdAt: number
  updatedAt: number
}

export interface MindNode {
  id: string
  label: string
  level: number // 1 起
  parentId: string | null
  originText?: string // 触发该节点的原文
  summary?: string // 搜索/AI 摘要
  provider?: string // 搜索引擎（bing/baidu/google/scholar）；AI 拆解节点无此字段
  status: 'pending' | 'searching' | 'done'
  createdAt: number
}

export interface Mindmap {
  id: string
  title: string
  paperId?: string
  nodes: MindNode[]
  createdAt: number
  updatedAt: number
}

export interface Note {
  id: string
  title: string
  tags: string[]
  paperId?: string
  updatedAt: number
  body: string // Markdown，frontmatter 之外
}

export interface Flashcard {
  id: string
  q: string
  a: string
  source?: { paperId: string; highlightId?: string }
  ef: number // SM-2 easiness factor
  interval: number // 天
  reps: number
  due: string // YYYY-MM-DD
  lastReview?: number
  createdAt: number
  updatedAt: number
}

export interface FocusSession {
  id: string
  start: number
  end: number
  minutes: number
  label?: string
  paperId?: string
}

export interface ModuleCalEvent {
  id: string
  moduleId: string
  title: string
  date: string
  time?: string
  endTime?: string
  color?: string
  meta?: Record<string, unknown>
  createdAt: number
}

export interface Appearance {
  accent: string // 主题强调色 #RRGGBB
  radius: number // 全局圆角 px
  fontScale: number // 界面整体缩放 0.85~1.3
}

/** 番茄钟配置 */
export interface PomodoroCfg {
  focusMin: number // 专注时长（分钟）
  breakMin: number // 休息时长（分钟）
  cycles: number // 循环次数（目标轮数）
  force: boolean // 强制专注（全屏 + 拦截 Win/Alt+Tab，休息时放开）
}

export interface Settings {
  ai: { baseURL: string; apiKey: string; model: string }
  github: { pat: string; owner: string; repo: string; autoSync?: number } // autoSync: 自动同步间隔分钟，0/undefined=关闭
  schedule: { semesterStart: string; periods: Period[] }
  devMode: boolean
  reader: { zoom: number }
  moduleState?: Record<string, boolean>
  appearance?: Appearance
  pomodoro?: PomodoroCfg
  navOrder?: string[] // 顶栏菜单顺序（key 列表，未列出的按默认顺序追加）
  navHidden?: string[] // 顶栏菜单隐藏项
  customEngines?: CustomEngine[] // 自定义搜索引擎（url 中 {q} 为关键词占位符）
  syncState?: { lastAt?: number; ok?: boolean; pushed?: number; pulled?: number; conflicts?: number; error?: string } // 最近一次同步结果
}

export interface CustomEngine {
  id: string
  name: string
  url: string
}

export const DEFAULT_PERIODS: Period[] = [
  { n: 1, start: '08:00', end: '08:45' },
  { n: 2, start: '08:55', end: '09:40' },
  { n: 3, start: '09:50', end: '10:35' },
  { n: 4, start: '10:45', end: '11:30' },
  { n: 5, start: '11:40', end: '12:25' },
  { n: 6, start: '14:00', end: '14:45' },
  { n: 7, start: '14:55', end: '15:40' },
  { n: 8, start: '15:50', end: '16:35' },
  { n: 9, start: '16:45', end: '17:30' },
  { n: 10, start: '18:30', end: '19:15' },
  { n: 11, start: '19:25', end: '20:10' },
  { n: 12, start: '20:20', end: '21:05' }
]

export const COURSE_COLORS = ['#5b8cff', '#37c99e', '#f5a623', '#ef5b7b', '#9d6bff', '#2bb3d6']

export function defaultSettings(): Settings {
  return {
    ai: { baseURL: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' },
    github: { pat: '', owner: '', repo: 'learnhub-data' },
    schedule: { semesterStart: '', periods: DEFAULT_PERIODS },
    devMode: false,
    reader: { zoom: 1 },
    moduleState: {},
    appearance: { accent: '#5b8cff', radius: 12, fontScale: 1 },
    pomodoro: { focusMin: 25, breakMin: 5, cycles: 4, force: false },
    navOrder: [],
    navHidden: [],
    customEngines: []
  }
}
