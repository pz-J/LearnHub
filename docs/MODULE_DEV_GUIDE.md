# LearnHub 模块开发指南（MODULE_DEV_GUIDE）

> 版本：1.0 ｜ 适用：LearnHub 集成学习中心（Electron 桌面端）
> 本文档列出开发**子模块（功能模块）**与**元模块（母模块）**所需的全部 API、权限目录、清单格式与开发方式。按本文档即可从零开发并安装一个新模块。

---

## 一、三层架构总览

```
┌────────────────────────────────────────────────┐
│ 宿主 Host（Electron 主进程 + React 渲染层）        │
│  引擎：PDF 渲染 / 日历 / AI 客户端 / 存储 / GitHub  │
│  内核：模块注册表 / 权限门禁 / 事件总线 / 授权 UI     │
├────────────────────────────────────────────────┤
│ 元模块层 type="meta"（高权限，安装需二次同意）        │
│  内置 meta-core：受理权限升级申请 → 弹授权对话框      │
├────────────────────────────────────────────────┤
│ 子模块层 type="feature"（沙箱 iframe 运行）         │
│  内置：日历/闪卡/番茄钟/翻译/统计/文献助手            │
│  外部：用户经「模块中心」安装的功能模块               │
└────────────────────────────────────────────────┘
```

- **子模块**：功能实现单元。在沙箱 iframe 中运行（无 Node、无宿主 DOM 直访），通过 `window.host` RPC 代理调用宿主 API，**每一次调用都经过权限门禁**。
- **元模块**：特殊高权限模块。当子模块声明的 API 权限不够用时，由元模块走**独立的高权限审批通道**（`meta.*` API）代为申请；安装元模块时用户必须对高权限做**二次同意**。
- **权限升级链路**：`子模块 host.requestPermission(cap, reason)` → 内核转交内置 meta-core → 校验清单 `optionalPermissions` → 弹授权对话框（模块名/能力/理由）→ 用户同意后写入 `userData/module-grants.json` 并即时生效；拒绝返回 `EPERMISSION`。

---

## 二、模块清单 module.json（Schema 固定）

模块根目录必须包含 `module.json`，与代码文件一起放在同一文件夹：

```json
{
  "id": "com.learnhub.flashcards",
  "name": "闪卡复习",
  "version": "1.0.0",
  "type": "feature",
  "entry": "index.js",
  "description": "一句话描述（显示在模块中心）",
  "author": "作者（可选）",
  "permissions": ["storage.own", "ui.panel"],
  "optionalPermissions": ["ai.invoke"],
  "network": { "allowedHosts": ["api.crossref.org"] },
  "contributes": {
    "panels": [{ "slot": "sidebar", "title": "侧栏标题" }],
    "routes": [{ "key": "flashcards", "title": "导航标题" }],
    "commands": []
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 全局唯一，仅 `字母数字._-`；安装后即 `userData/modules/<id>/` 目录名 |
| `name` / `version` / `type` / `entry` | ✅ | `type` 为 `feature`（子模块）或 `meta`（元模块）；`entry` 为入口 JS 文件（相对模块根目录） |
| `permissions` | ✅ | **必需权限**：安装确认页列出，用户同意后安装并立即生效 |
| `optionalPermissions` | — | **可选权限**：不随安装授予；模块运行时经 `host.requestPermission` 申请，逐次弹窗审批 |
| `network.allowedHosts` | — | `network.fetch` 的域名白名单，支持 `*.example.com` 通配 |
| `contributes.panels` | — | 注册侧边栏面板，`slot` 目前支持 `sidebar` |
| `contributes.routes` | — | 注册顶部导航路由（整页视图） |

校验规则（宿主 `validateManifest`）：缺字段、非法 id、未知能力名都会被拒绝安装。

---

## 三、权限目录（Capability Catalog）

宿主内核写死，模块**必须声明**（必需或可选）才能使用对应 API：

| 能力 | 说明 | 等级 | 限制 |
|---|---|---|---|
| `storage.own` | 模块私有存储（本模块专属 KV） | 普通 | |
| `storage.data` | 读写学习数据（待办/课表/笔记/闪卡/文献） | 普通 | |
| `files.pick` | 文件对话框（保存/打开文本文件） | 普通 | |
| `pdf.read` | 读取论文 PDF 内容 | 普通 | |
| `network.fetch` | 按清单域名白名单发起网络请求 | 普通 | 域名必须在 `network.allowedHosts` |
| `ai.invoke` | 调用用户配置的 AI（流式） | 普通 | |
| `calendar.write` | 写入/删除日历事件（标注来源模块） | 普通 | |
| `reader.annotate` | 读写高亮批注、注册选区工具条按钮、打开论文 | 普通 | |
| `ui.panel` | 注册面板/导航/悬浮部件 | 普通 | 面板仍需在清单 `contributes` 声明 |
| `ui.theme` | 读取并调整界面主题（强调色/圆角/界面缩放） | 普通 | 参数会被范围校验，写入全局外观设置 |
| `clipboard` | 写入剪贴板 | 普通 | |
| `notify` | 发送系统通知 | 普通 | |
| `links.open` | 在默认浏览器中打开 HTTPS 链接 | **敏感** | 主进程重新检查模块清单与已持久化授权 |
| `meta.escalate` | 代其他模块申请宿主已实现的可选权限 | **高危** | 仅 `type:"meta"` |
| `achievements.award` | 向成就系统登记已完成任务（用户在成就页领取积木奖励） | 普通 | 同一 taskId 存在未领取记录时重复登记会被拒绝，防刷积木 |

等级颜色：普通=蓝、敏感=橙、高危=红。安装确认页按等级分组展示，高危权限有显著警示。

---

## 四、子模块 API 全参考（`window.host.*`）

沙箱中宿主注入 `window.host`（Promise RPC 代理）与 `window.host.events`。**所有方法参数是一个对象**，返回 Promise。

### 4.1 生命周期与信息
| API | 说明 |
|---|---|
| `host.manifest` | 本模块清单（含 id/name/version/type/permissions） |
| `host.requestPermission({ capability, reason })` | 申请可选权限 → 走元模块审批 → `{ granted: boolean, reason?: string }` |
| `host.capabilities.describe()` | 完整权限目录（用于自检/展示） |

### 4.2 私有存储（需 `storage.own`）
| API | 说明 |
|---|---|
| `host.storage.get({})` | 读取本模块整个存储对象 |
| `host.storage.set({ obj })` | 整体覆盖写入 |
| `host.storage.clear({})` | 清空 |

### 4.3 学习数据（需 `storage.data`）
| API | 说明 |
|---|---|
| `host.data.todos.list({})` / `.add({ todo })` / `.update({ id, patch })` / `.remove({ id })` | 待办 CRUD（字段见 types：title/date/time/priority/done/repeat/tags） |
| `host.data.schedule.get({})` | 课表（semesterStart/periods/courses） |
| `host.data.notes.list({ paperId? })` / `.write({ id?, patch })` / `.remove({ id })` | Markdown 笔记（自动 frontmatter） |
| `host.data.flashcards.list({})` / `.add({ card })` / `.update({ id, patch })` / `.remove({ id })` | 闪卡 |
| `host.data.papers.list({})` / `.get({ paperId })` / `.update({ paperId, patch })` | 文献元数据/高亮/搜索记录 |
| `host.achievements.award({ taskId, title })` | 向成就系统登记模块任务（需 `achievements.award`），用户在成就页领取积木；返回 boolean |

### 4.4 AI（需 `ai.invoke`）
```js
const text = await host.ai.chat({
  messages: [{ role: 'user', content: '你好' }],
  temperature: 0.4,
  reqId: 'my-req-1'   // 可选：流式事件会带此 id
})
// 流式块通过事件接收：events.on('ai:chunk', p => p.payload.delta)
```

### 4.5 网络（需 `network.fetch` + 白名单）
```js
const r = await host.network.fetch({ url: 'https://api.crossref.org/works?…', init: { method: 'GET', headers: {} } })
// r = { status, text }
```

网络 API 仅接受不含用户名/密码的 HTTPS URL；域名必须匹配清单白名单，重定向会被拒绝。单次请求最多等待 15 秒，响应体上限为 1 MB。模块 iframe 的 CSP 禁止直接网络连接，网络访问应通过该 API。

### 4.6 日历（需 `calendar.write`）
| API | 说明 |
|---|---|
| `host.calendar.addEvents({ events: [{ title, date:'YYYY-MM-DD', time?, endTime?, color? }] })` | 写入日历（自动标注来源模块，日历页可见） |
| `host.calendar.removeEvents({ filter: { date? } 或 { id? } })` | 删除本模块写入的事件 |

### 4.7 阅读器（需 `reader.annotate`）
| API | 说明 |
|---|---|
| `host.reader.getSelection({})` | 当前选区 `{ text, page, rects, highlightId? }` 或 null |
| `host.reader.addHighlight({ paperId, highlight: { page, rects, text, color } })` | 添加高亮（rects 为页面归一化坐标） |
| `host.reader.openPaper({ paperId })` | 在阅读器打开论文 |
| `host.reader.registerToolbarButton({ id, title })` | 注册选区浮动工具条按钮；点击时宿主广播事件 `reader:toolbar-click`（payload 含 `moduleId/id/text`） |

### 4.8 UI / 通知 / 剪贴板 / 文件
| API | 权限 | 说明 |
|---|---|---|
| `host.ui.notify({ title, body })` | `notify` | 系统通知 + 应用内 Toast |
| `host.ui.toast({ text })` | `ui.panel` | 应用内 Toast |
| `host.ui.registerPanel({})` / `host.ui.registerRoute({})` | `ui.panel` | 自检已声明面板/路由（实际注册以清单 `contributes` 为准） |
| `host.ui.theme({ accent?, radius?, fontScale? })` | `ui.theme` | 调整界面主题：`accent` 为 `#RRGGBB`、`radius` 2~20px、`fontScale` 0.85~1.3；只传需要改的字段，返回更新后的完整主题 |
| `host.clipboard.write({ text })` | `clipboard` | 写剪贴板 |
| `host.files.saveText({ fileName, content })` | `files.pick` | 另存文本文件 |
| `host.files.openText({ filters? })` | `files.pick` | 打开文本文件 |

### 4.9 事件总线（`host.events`）
```js
window.events.on(name, payload => {})   // 订阅宿主广播
window.events.emit(name, payload)       // 向宿主与其他模块广播
window.events.off(name, fn)
```

**外部模块事件限制：**

- 可订阅：`focus:done`、`sync:done`、`reader:paper-opened`、`data:todo-updated`、`data:schedule-updated`、`data:notes-updated`、`data:flashcards-updated`。
- 可发布：`search:open`、`ai:explain` 和四类数据更新通知。
- 其他内部事件（尤其是阅读器选区、选中文本和高亮载荷）不会通过外部模块事件桥转发。单次事件载荷上限为 32 KB；订阅在 iframe 卸载时清理，调用中的网络/AI/权限请求会尽力取消。

**核心事件表：**

| 事件名 | 载荷 | 触发时机 |
|---|---|---|
| `reader:selection-changed` | `{ text, page, rects } \| null` | 阅读器选区变化 |
| `reader:highlight-added` | `{ paperId, highlight }` | 新增高亮 |
| `reader:highlight-removed` | `{ paperId, highlightId }` | 删除高亮 |
| `reader:scroll-to-highlight` | `{ paperId, highlightId }` | 请求 PDF 滚动定位（笔记面板联动） |
| `reader:toolbar-click` | `{ moduleId, id, text, paperId }` | 模块注册的选区工具条按钮被点击 |
| `reader:paper-opened` | `{ paperId }` | 打开论文 |
| `search:open` | `{ text, paperId? }` | 用户请求搜索一段文字（搜索链路面板会接住：自动挂到当前层 / 新建链路） |
| `ai:explain` | `{ text, paperId? }` | 用户请求 AI 解释一段文字（AI 面板接住并流式回答） |
| `data:todo-updated` / `data:schedule-updated` / `data:notes-updated` / `data:flashcards-updated` | — | 对应数据变更 |
| `sync:done` | `{ pushed, pulled, conflicts }` | GitHub 同步完成 |
| `focus:done` | FocusSession | 番茄钟完成一次专注 |
| `ai:chunk` | `{ reqId, delta }` | AI 流式块（仅发给发起调用的沙箱模块） |

---

## 五、元模块 API（`host.meta.*`，仅 `type:"meta"`）

清单 `permissions` 必须包含 `meta.escalate`（高危）。安装时模块中心会显示红色高权限警示并要求勾选二次同意。

| API | 说明 |
|---|---|
| `host.meta.requestPermission({ moduleId, capability, reason })` | **代目标模块申请能力**：弹授权对话框（显示申请方/目标/能力/理由），同意即写入授权并生效 |
| `host.meta.grants({ moduleId })` | 查询目标模块当前持有的运行时授权列表 |
| `host.meta.revoke({ moduleId, capability })` | 撤销目标模块已声明的可选权限（立即失效）；必需权限需停用或卸载模块 |
| `host.meta.listModules({})` | 列出全部已注册模块（含清单与启停状态） |
| `host.meta.getSettings({})` | 非密钥设置摘要（`{ aiConfigured, aiBaseURL, githubConfigured, devMode }`） |

**预留能力**（权限目录已定义、后续宿主版本开放，当前调用会返回未知 API 错误）：
- `meta.registerCapability`、`meta.bridge` 和 `github.sync` 模块 API：**预留设计，当前没有可调用实现，也不属于可声明权限目录**。旧模块若声明这些权限，需删除声明后重新安装。外部模块不能动态注册主进程 IPC；新增特权能力必须先在宿主实现明确的 API、参数校验与主进程授权后才能开放。

---

## 六、沙箱运行环境

- 外部模块以 **iframe srcdoc** 运行：`sandbox="allow-scripts allow-forms"`，无 Node、无 `require`、无宿主 DOM 直访，也不能弹出阻塞式浏览器对话框；CSP 禁止模块直接联网、嵌套 frame 和表单提交。
- 宿主通过 `postMessage` 注入引导脚本：`window.host`（RPC 代理，方法路径自动映射到 `dispatchApi`）、`window.events`、`window.manifest`。
- 启动时序：iframe 加载 → 发 `hello` → 宿主回 `init`（含 token 与清单）→ 触发 `host-ready` 事件 → 之后才可调用 `host.*`。
- 单文件 ≤ 2MB、总大小 ≤ 8MB、最多 200 个文件；`node_modules`、`.git`、二进制资源（图片/字体/PDF/压缩包/可执行文件）不会被读取——**模块应保持纯 JS/JSON**。
- 沙箱为 iframe 级隔离（能力门禁 + 无 Node 直访），非恶意对抗级安全边界；只安装可信来源的模块。

---

## 七、开发与安装流程

1. 新建文件夹（建议命名即模块 id），写入 `module.json` + `entry` 指定的 `index.js`（纯 JS，面向沙箱 API）。
2. 打开 LearnHub →「模块中心」→「安装模块」→ 选择该文件夹。
3. 审阅**权限确认页**（按普通/敏感/高危分色；元模块有红色高权限警示）→ 勾选「我已了解并同意」→「同意并安装」。
4. 子模块的侧栏面板/导航路由自动出现；在「权限详情」中可查看/撤销运行时授权，随时启停/卸载。
5. 批量导入：把多个模块文件夹放进同一个父文件夹（每个子文件夹含 `module.json`），用「批量导入」选中父文件夹，即可在统一确认页逐个审阅权限后一次安装；损坏或非模块子文件夹会被跳过并提示。
6. 更新迭代：再次选择同一模块会显示更新确认页。确认后，宿主先在暂存目录验证并写入文件，再替换旧代码；更新保留模块私有存储，并清除额外授权，更新后的模块需要重新申请可选权限。内置 `core.*` 模块不可被外部模块覆盖。
7. 授权记录存于 `userData/module-grants.json`（不参与 GitHub 同步）；模块私有存储经 `modstore:read` / `modstore:write` 服务落盘，并打包为单文件 `module-storage.json` 参与 GitHub 同步（克制上传，不逐模块建文件）——换机后重新安装模块，数据随同步自动恢复。卸载会清除授权和运行实例，但保留私有存储，方便同 ID 模块重新安装后恢复；如需彻底清理，请在用户数据目录中手动备份后删除对应存储文件。

> 参考：仓库 `modules/example-hello/` 是完整可安装示例（面板注册 + 私有存储 + 运行时申请 `ai.invoke`/`notify`/`achievements.award` + 事件订阅 + 成就任务登记对接），复制后改 id 即可作为起点。成就对接最小示例见其「登记一个成就任务」按钮：申请 `achievements.award` 后调用 `host.achievements.award({ taskId, title })`，返回 `false` 表示该 taskId 已有未领取记录。

仓库还提供一组实际功能示例：

- `modules/com-learnhub-study-journal/`：科研日志，注册为顶部主导航整页入口，记录研究想法/阅读笔记/实验记录/下一步计划，订阅 `focus:done` 自动归档专注时段，支持 Markdown 导出和授权后的 AI 日总结。数据保存在模块私有存储中。
- `modules/com-learnhub-meta-permission-center/`：元模块权限管家，注册为顶部主导航整页入口，可查看已安装模块的权限声明和授权状态，并为模块申请或撤销其清单中声明的可选权限。
- `modules/com-learnhub-review-planner/`：复习规划，注册为顶部主导航整页入口，基于艾宾浩斯遗忘曲线（+1/+3/+7/+16/+35 天，遇周末自动顺延周一）为论文生成复习节点并写入日历，提供今日到期队列与复习打卡记录，可选 AI 根据标记与问答归档生成自测题。需 `calendar.write` 等权限，`ai.invoke`/`notify` 为可选。
- `modules/com-learnhub-study-export/`：导出复习稿，注册为顶部主导航整页入口，勾选多篇论文后汇总思维链路问答（按搜索层级分组）、归档答案与标记解释，生成结构化 Markdown 复习稿，支持预览与单篇/合并导出（`files.pick` 授权后保存），`clipboard` 为可选。
- `modules/com-learnhub-paper-guide/`：精读向导，注册为顶部主导航整页入口，基于论文的标记与问答流式生成六节 AI 导读（研究问题/方法要点/主要结论/术语速查/疑点追问/与我标记的联系），保留每篇最近 5 份历史，可一键存为笔记。需 `ai.invoke`。
- `modules/com-learnhub-vocab-box/`：生词本，注册为侧栏面板，通过阅读器工具条按钮一键收词并在原文打紫色标记，支持 AI 释义、备注、搜索、CSV 导出与复制。需 `reader.annotate` 等权限，`ai.invoke`/`clipboard` 为可选。

建议先安装科研日志，再安装权限管家；复习规划、精读向导、生词本、导出复习稿按学习流程自行选用。科研日志的 `ai.invoke` 和 `files.pick` 是可选权限，首次使用相应功能时才会请求授权。元模块也可管理示例模块的 `notify` 权限。元模块只能管理宿主已实现的权限目录；任意主进程桥接仍未开放。新增特权能力时，需在宿主添加固定 API、主进程独立校验和明确授权规则（网络类可参考 `core.litman` 与主进程 `module:openExternal` 的清单+授权双重校验实现）。

> 说明：原 `com-learnhub-literature-finder`（文献发现）与内置 `core.litman` 文献助手功能重复，已合并移除；Crossref 检索、BibTeX 导出与 DOI 打开统一由内置文献助手提供。

---

## 八、内置模块清单（宿主随应用注册，可停用不可卸载）

| id | 名称 | 类型 | 能力入口 |
|---|---|---|---|
| `core.meta` | 元模块核心 | meta | 内置审批代理（meta-core） |
| `core.calendar` | 日历待办 | feature | 顶部导航「日历」 |
| `core.flashcards` | 闪卡复习 | feature | 顶部导航「闪卡」 |
| `core.pomodoro` | 番茄钟 | feature | 导航栏悬浮部件 |
| `core.translate` | 划词翻译 | feature | 侧栏「翻译」+ 选区工具条按钮 |
| `core.stats` | 学习统计 | feature | 顶部导航「统计」 |
| `core.achievements` | 成就大楼 | feature | 顶部导航「成就」；积木搭建游戏 + 外部模块任务登记入口 |
| `core.litman` | 文献助手 | feature | 侧栏「文献助手」 |

**成就大楼玩法（core.achievements）**：领取成就/任务奖励的积木先进库存，再从形状库拖到画布搭建。物理为自研简化刚体模型（`src/renderer/src/lib/towerPhysics.ts`）：房顶中心固定、大重量向下施力，载荷沿接触面按重叠长度比例传播，任一层「上方载荷+自重」合成质心滑出支撑并集即倾覆——房顶塌落时放置被拒绝并自动回退到最后一块之前，天然阻止细长悬臂作弊。形状库含 7 种预设，并支持 8x8 网格自画形状入库。画布支持滚轮缩放（0.6x-3x，以光标为锚点）、右键/中键拖拽平移与「重置视角」，放置成功有下落弹跳动效，破纪录时楼顶弹出增量浮动数字并闪烁「新纪录」。四关（阿尔卑斯草地/沙漠金字塔/樱花庭院/星夜灯塔）按历史最高楼高解锁，各有专属背景与房顶样式；每关另有按楼高里程碑解锁的场景装饰（`LevelScenes.tsx` 的 `SCENE_PROPS`：草地飞鸟/山腰缆车/热气球、沙鹰/驼队、灯笼/蝴蝶、夜海海鸥/灯塔旋转光束/流星），解锁瞬间画布顶部弹出庆祝横幅，装饰动画仅 CSS/SMIL 无每帧 JS 开销。楼高与库存数据存 `data/tower.json`（参与 GitHub 同步）。开发者测试：在成就页依次输入 `↑↑↓↓←→←→ b a b a`（科乐美秘技）可获得金色测试积木。

**论文阅读器内置增强（宿主功能，模块可经 `reader.*` 能力联动）**：全文搜索（Ctrl+F，结果列表点击跳页并橙色高亮全部命中，Enter/Enter/F3 在本页逐处循环）、PDF 目录大纲跳转、页面缩略图导航（懒渲染，进入视口才画，当前页高亮，有标注的页右上角显示标注数角标，点击跳页）、页码输入直达、标注列表回跳原文（复用 `scrollToHighlight` 事件，外部模块标注同样可回跳）与标注 Markdown 双出口：复制到剪贴板或一键写入本文笔记（按页分组含批注/解释，幂等区块可反复同步不堆积，笔记随 GitHub 同步）、引用复制（选区工具条「引」/右键菜单，生成引文+文献标题+页码）、引用内链跳转（点击 [12] 类引用标注直达目标页，解析 PDF 注释内部 dest，悬停高亮并提示目标页码）、夜间反色护眼、Zotero 式锁定高亮色连刷（选区工具条「锁」按钮，选中即标）、批注编辑条内一键改高亮颜色、快捷键（←/→/PgUp/PgDn 翻页、Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+滚轮缩放且缩放前后按滚动比例恢复阅读位置不丢当前视口、Esc 关面板/停自动滚屏）、自动滚屏（顶栏「自动」按钮 1x/2x/关循环，滚到底自动翻下一页续读、读到末页自动关，任何手动滚轮/按下/触摸/翻页/Esc 立即停止）、Ctrl+Z 撤销最近一次高亮、顶栏显示阅读进度百分比（点击百分比可复位缩放）、阅读位置自动记忆、标注面板支持按正文/批注文本过滤。成就列表自动把「可领取」置顶、已领取置底；成就页顶部有学习成果统计条（历史最高楼高/待放置积木/可领取/已领），画布内在可视区内绘制待解锁高度的「再高 N 解锁」虚线刻度，点选积木后移动鼠标实时显示落点虚影，放置后同形状库存有剩余时自动选中下一块支持连续叠放，连续成功放置积木显示「连击 xN」徽标（塌落或撤回清零），历史最高连击持久化到 `tower.json` 并在统计条展示，领取积木弹层确认后展示「领取成功」动效并自动关闭；全局挂载 `AchievementToasts` watcher（启动延迟 1.5s 武装基线，避免 store 异步加载误报历史达标），成就达标瞬间即使不在成就页也会弹 toast 提醒领取，搭建指标（楼高/连击）同样纳入监控；内置成就共 13 项，其中「摩天大楼」（历史最高楼高 50）与「十连巧匠」（连续成功放置 10 块）两项由积木玩法直接达成——玩成就大楼本身也能解锁成就领取积木，形成游戏化正反馈循环。阅读器空状态提供「继续阅读」一键回到最近论文（配合页码位置记忆直达上次进度）。

内置模块为进程内组件（不经 iframe 沙箱），但清单/权限展示与管理方式与外部模块一致，可作为 API 使用范本阅读源码 `src/renderer/src/components/builtin-modules/`。

---

## 九、常见问题

- **调用报 `EPERMISSION`**：能力未在清单声明（加进 `permissions` 或 `optionalPermissions`），或运行时授权被用户拒绝/撤销。可选权限请先 `host.requestPermission` 并处理拒绝分支。
- **`network.fetch` 域名错误**：目标域名未加入清单 `network.allowedHosts`（支持 `*.host.com`）。
- **面板/导航没出现**：`contributes.panels/routes` 未声明，或模块被停用（模块中心可开启）。
- **AI 报「尚未配置 API Key」**：宿主「设置」页未配置；`ai.invoke` 使用用户全局 AI 配置。
- **清单校验失败**：核对 id 字符集、type 取值、能力名拼写（以第三章目录为准）。

—— 完 ——
