import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearch, allEngines } from '@/stores/search'
import { useUi } from '@/stores/ui'
import { usePapers } from '@/stores/papers'
import { useMindmaps } from '@/stores/mindmaps'
import { useSettings } from '@/stores/settings'
import { eventBus } from '@/kernel/eventBus'
import { ChainMap, chainPath } from './ChainMap'
import { lh, uid } from '@/lib/ipc'
import { truncate } from '@/lib/utils'
import { aiAsk } from '@/lib/ai'
import type { MindNode } from '@/types'

/**
 * 搜索链路面板（侧栏 variant=side / 主界面 variant=overlay 共用一套全局状态）。
 * 交互设计：
 *  - 论文选中 → 🔍 → 侧边栏向左展开（stage 1）
 *  - 在搜索页选中文字「继续搜索」= 对解释仍有困惑 → 挂到导图分叉 + 展开成主界面（stage 2）
 *  - 找到答案：选中文字「收为答案」→ 折叠到最初搜索内容下方 + 自动收回侧边栏（stage 0）
 */
export function SearchPanel({ variant = 'side' }: { variant?: 'side' | 'overlay' }) {
  const s = useSearch()
  const activePaperId = useUi((st) => st.activePaperId)
  const setSidebarTab = useUi((st) => st.setSidebarTab)
  const toggleSidebar = useUi((st) => st.toggleSidebar)
  const setSearchStage = useUi((st) => st.setSearchStage)
  const searchStage = useUi((st) => st.searchStage)
  const goBack = s.goBack
  const webRef = useRef<HTMLElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ text: string; x: number; y: number } | null>(null)
  // 「收为答案」编辑面板（x/y 缺省时居中显示；src 为来源链接）
  const [ansEditor, setAnsEditor] = useState<{ text: string; x?: number; y?: number; src?: string } | null>(null)

  // webview 内右键（主进程 context-menu 转发，preload 之外的可靠通道）
  useEffect(
    () =>
      lh.onWebCtx((p) => {
        useSearch.getState().set({ selText: p.text })
        showWebCtx(p.text, p.x, p.y)
      }),
    []
  )

  const map = useMindmaps((st) => (s.mapId ? st.maps[s.mapId] : undefined))
  const cur = map?.nodes.find((n) => n.id === s.curId) ?? null

  const breadcrumb = useMemo(() => (map && cur ? chainPath(map, cur) : []), [map, cur])

  /** AI 拆解当前节点：生成 3 个子知识点（点击子节点即可作为关键词继续搜索） */
  const drill = async () => {
    if (!map || !cur || s.aiBusy) return
    s.set({ aiBusy: true })
    useMindmaps.getState().updateNode(map.id, cur.id, { status: 'searching' })
    try {
      const ans = await aiAsk(
        `围绕「${cur.label}」进行检索式学习总结：给出 3 个最重要的子知识点。每行格式严格为：子知识点 - 一句话解释。不要输出其他内容。`,
        '你是学术检索助手，输出中文。'
      )
      const lines = ans
        .split('\n')
        .map((l) => l.replace(/^[-•\d.\s]+/, '').trim())
        .filter((l) => l.includes('-'))
        .slice(0, 4)
      for (const line of lines) {
        const [label, ...rest] = line.split('-')
        useMindmaps.getState().addNode(map.id, {
          label: label.trim().slice(0, 40),
          level: cur.level + 1,
          parentId: cur.id,
          originText: cur.label,
          summary: rest.join('-').trim(),
          status: 'done'
        })
      }
      useMindmaps.getState().updateNode(map.id, cur.id, { summary: ans.slice(0, 200), status: 'done' })
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error')
      useMindmaps.getState().updateNode(map.id, cur.id, { status: 'done' })
    } finally {
      s.set({ aiBusy: false })
    }
  }

  const applyZoom = (f: number) => {
    const v = Math.min(1.5, Math.max(0.4, +f.toFixed(2)))
    s.set({ zoomF: v })
    ;(webRef.current as unknown as { setZoomFactor?: (x: number) => void } | null)?.setZoomFactor?.(v)
  }

  // webview 内坐标 → 窗口视口坐标：先乘缩放系数（params.x/y 是页面 CSS 坐标，视觉位置 = CSS × zoomF），
  // 再加 webview 容器偏移；直接用会被上方导图/头部高度顶偏、且随缩放向右下漂移
  const showWebCtx = (text: string, x: number, y: number) => {
    const r = webRef.current?.getBoundingClientRect()
    const z = useSearch.getState().zoomF || 1
    setCtxMenu(r ? { text, x: r.left + x * z, y: r.top + y * z } : { text, x: x * z, y: y * z })
  }

  const onIpc = (e: { channel: string; args: unknown[] }) => {
    if (e.channel === 'lh:selection') s.set({ selText: String(e.args[0] ?? '') })
    else if (e.channel === 'lh:selctx') {
      // webview 内右键：带选中文字与坐标 → 弹快捷菜单（搜索/解释）
      const d = e.args[0] as { text: string; x: number; y: number }
      s.set({ selText: d.text })
      showWebCtx(d.text, d.x, d.y)
    }
  }

  // <webview> 是自定义元素：React 的 onXxx prop 不会绑定其 DOM 事件（onIpcMessage 静默失效），
  // 必须挂载时用原生 addEventListener 接 ipc-message / dom-ready / did-navigate
  const attachWeb = useCallback((el: HTMLElement | null) => {
    webRef.current = el
    if (!el) return
    el.addEventListener('ipc-message', onIpc as unknown as EventListener)
    const rezoom = () => applyZoom(useSearch.getState().zoomF)
    el.addEventListener('dom-ready', rezoom)
    el.addEventListener('did-navigate', rezoom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 搜索框提交：全屏 = 当前层下继续（下一层）；侧栏 = 原文语境的新搜索（并列新根）；无链路 = 第一层 */
  const submit = () => {
    const q = s.query.trim()
    if (!q) return
    if (map && cur) {
      if (overlay) void s.continueSearch(q)
      else void s.doSearch(q, { asRoot: true })
    } else {
      setSearchStage(1)
      toggleSidebar(true)
      void s.doSearch(q)
    }
  }

  const overlay = variant === 'overlay'

  // 引擎列表（内置 + 自定义），自定义引擎随设置变化
  const customEngines = useSettings((st) => st.settings.customEngines)
  const updateSettings = useSettings((st) => st.update)
  const engines = useMemo(() => allEngines(), [customEngines])
  const isApi = !!s.engOf(s.engine).api

  // 添加自定义引擎表单
  const [addEng, setAddEng] = useState(false)
  const [engName, setEngName] = useState('')
  const [engUrl, setEngUrl] = useState('')
  const saveEngine = async () => {
    const name = engName.trim()
    const url = engUrl.trim()
    if (!name || !url.includes('{q}')) {
      useUi.getState().toast('需要名称，且 URL 中要包含 {q} 占位符', 'error')
      return
    }
    await updateSettings({ customEngines: [...(customEngines ?? []), { id: uid('eng_'), name, url }] })
    setEngName('')
    setEngUrl('')
    setAddEng(false)
    useUi.getState().toast('已添加自定义引擎', 'ok')
  }
  const removeEngine = async (id: string) => {
    await updateSettings({ customEngines: (customEngines ?? []).filter((c) => c.id !== id) })
    if (s.engine === id) s.set({ engine: 'bing-academic' })
  }

  // 内联翻译（网页选区 / 学术结果摘要）
  const [tr, setTr] = useState<{ src: string; out: string; busy: boolean } | null>(null)
  const translate = async (text: string) => {
    if (tr && tr.src === text) {
      setTr(null)
      return
    }
    setTr({ src: text, out: '', busy: true })
    try {
      const out = await aiAsk(
        `将以下内容准确翻译为简体中文（若原文本身是中文则翻译为英文），只输出译文：\n\n${text}`,
        '你是专业学术翻译，术语准确、语句通顺。'
      )
      setTr({ src: text, out, busy: false })
    } catch (e) {
      setTr(null)
      useUi.getState().toast('翻译失败：' + (e as Error).message, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部：主界面 = 返回按钮 + 层级标签；侧栏 = 引擎 + 搜索框 */}
      {overlay ? (
        <div className="flex items-center gap-2 border-b border-line bg-bg-card px-3 py-2">
          <button
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-bg-hover"
            onClick={goBack}
            title="收回到侧边栏（继续阅读论文）"
          >
            ← 收回侧边栏
          </button>
          {/* 浏览器式层级标签：一层一个标签，点击即回跳 */}
          <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
            {breadcrumb.map((n) => (
              <button
                key={n.id}
                className={`shrink-0 rounded-t-lg border px-3 py-1.5 text-xs ${
                  n.id === cur?.id ? 'border-line border-b-bg-card bg-bg-card font-medium text-accent' : 'border-transparent bg-bg-soft text-txt-dim hover:text-txt'
                }`}
                title={n.label}
                onClick={() => void s.doSearch(n.label, { jumpTo: n })}
              >
                <span className="mr-1 opacity-60">L{n.level}</span>
                {truncate(n.label, 18)}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <select className="rounded border border-line bg-bg px-1.5 py-1.5 text-xs" value={s.engine} onChange={(e) => s.set({ engine: e.target.value })}>
              {engines.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.name}
                </option>
              ))}
            </select>
            <input
              className="w-64 rounded border border-line bg-bg px-2 py-1.5 text-sm"
              placeholder="在当前层下继续搜索，回车提交…"
              value={s.query}
              onChange={(e) => s.set({ query: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2 border-b border-line p-2">
          <div className="flex flex-wrap items-center gap-1">
            {engines.map((en) => (
              <span key={en.id} className="inline-flex items-center overflow-hidden rounded border border-line">
                <button
                  className={`px-2 py-1 text-xs ${s.engine === en.id ? 'bg-accent text-white' : 'hover:bg-bg-hover'}`}
                  onClick={() => s.set({ engine: en.id })}
                >
                  {en.name}
                </button>
                {en.custom && (
                  <button className="border-l border-line px-1 py-1 text-[10px] text-txt-dim hover:bg-red-500/10 hover:text-red-400" title="删除该自定义引擎" onClick={() => void removeEngine(en.id)}>
                    ×
                  </button>
                )}
              </span>
            ))}
            <button
              className={`rounded border px-2 py-1 text-xs ${addEng ? 'border-accent text-accent' : 'border-dashed border-line text-txt-dim hover:bg-bg-hover'}`}
              onClick={() => setAddEng(!addEng)}
              title="添加自定义搜索引擎"
            >
              + 引擎
            </button>
          </div>
          {addEng && (
            <div className="space-y-1 rounded-lg border border-line bg-bg-soft p-2">
              <input
                className="w-full rounded border border-line bg-bg px-2 py-1 text-xs"
                placeholder="引擎名称，如：谷歌学术"
                value={engName}
                onChange={(e) => setEngName(e.target.value)}
              />
              <input
                className="w-full rounded border border-line bg-bg px-2 py-1 font-mono text-xs"
                placeholder={'搜索 URL，用 {q} 代表关键词，如 https://x.com/search?q={q}'}
                value={engUrl}
                onChange={(e) => setEngUrl(e.target.value)}
              />
              <div className="flex gap-1">
                <button className="rounded bg-accent px-2 py-1 text-xs text-white hover:opacity-90" onClick={() => void saveEngine()}>
                  保存
                </button>
                <button className="rounded border border-line px-2 py-1 text-xs hover:bg-bg-hover" onClick={() => setAddEng(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-1">
            <input
              className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1.5 text-sm"
              placeholder="搜索关键词（自动接在当前层下）"
              value={s.query}
              onChange={(e) => s.set({ query: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90" onClick={submit}>
            搜
          </button>
          </div>
        </div>
      )}

      {/* 侧栏模式：路径条（第 N 层 + 面包屑 + 回原文） */}
      {!overlay && map && cur && breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 border-b border-line bg-bg-soft px-2 py-1.5 text-[11px]">
          <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-accent">第 {cur.level} 层</span>
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {breadcrumb.map((n, i) => (
              <span key={n.id} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <span className="text-txt-dim">→</span>}
                <button
                  className={`max-w-[110px] truncate rounded px-1 py-0.5 ${n.id === cur.id ? 'bg-accent/15 font-medium text-accent' : 'text-txt-dim hover:bg-bg-hover hover:text-txt'}`}
                  title={n.label}
                  onClick={() => void s.doSearch(n.label, { jumpTo: n })}
                >
                  {n.label}
                </button>
              </span>
            ))}
          </div>
          <button
            className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-txt-dim hover:border-accent hover:text-accent"
            title="展开为主界面（覆盖论文，左上角可随时收回）"
            onClick={() => setSearchStage(2)}
          >
            展开主界面
          </button>
          {searchStage === 1 ? (
            <button
              className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-txt-dim hover:border-accent hover:text-accent"
              title="收起为窄侧边栏，回到原文继续阅读"
              onClick={() => setSearchStage(0)}
            >
              回原文
            </button>
          ) : (
            <button
              className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-txt-dim hover:border-accent hover:text-accent"
              title="展开为宽体侧边栏"
              onClick={() => setSearchStage(1)}
            >
              展开
            </button>
          )}
          <button
            className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-txt-dim hover:border-accent hover:text-accent"
            onClick={() => s.set({ showMap: !s.showMap })}
            title="展开/收起链路图"
          >
            {s.showMap ? '收起导图' : '展开导图'}
          </button>
        </div>
      )}

      {/* 侧栏模式：链路导图（可折叠） */}
      {!overlay && s.showMap && map && <ChainMap map={map} className="h-52 shrink-0 border-b border-line" onNodeClick={(n) => void s.doSearch(n.label, { jumpTo: n })} />}
      {!overlay && s.showMap && !map && (
        <div className="border-b border-line px-3 py-2 text-[11px] leading-5 text-txt-dim">
          还没有搜索链路：输入关键词，或在论文中选中文字点「搜索」开始。之后每次继续搜索都会挂到当前层下，这里会长出你的搜索路径图。
        </div>
      )}

      {/* 内联翻译结果 */}
      {tr && (
        <div className="border-b border-line bg-bg-soft px-3 py-2 text-xs leading-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">译文</span>
            <span className="min-w-0 flex-1 truncate text-txt-dim" title={tr.src}>
              {truncate(tr.src, 60)}
            </span>
            {tr.out && (
              <button
                className="text-txt-dim hover:text-accent"
                title="复制译文"
                onClick={() => {
                  void lh.clipboardWrite(tr.out)
                  useUi.getState().toast('译文已复制', 'ok')
                }}
              >
                ⧉
              </button>
            )}
            <button className="rounded-md border border-line px-1.5 py-0.5 text-txt-dim hover:border-accent hover:text-accent" onClick={() => setTr(null)} title="关闭译文">
              ×
            </button>
          </div>
          <div className="whitespace-pre-wrap text-txt">{tr.busy ? '翻译中…' : tr.out}</div>
        </div>
      )}

      {/* 结果区：学术 API 原生列表 / 内嵌网页（可缩放）；原生列表同样支持选中/右键 */}
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        {isApi ? (
          <div
            className="h-full overflow-y-auto p-2"
            onMouseUp={() =>
              setTimeout(() => {
                const t = window.getSelection()?.toString().trim()
                if (t) s.set({ selText: t.slice(0, 500) })
              }, 0)
            }
            onContextMenu={(e) => {
              const t = window.getSelection()?.toString().trim()
              if (!t) return
              e.preventDefault()
              const r = wrapRef.current?.getBoundingClientRect()
              setCtxMenu({ text: t.slice(0, 500), x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) })
            }}
          >
            {s.schLoading && <div className="p-3 text-xs text-txt-dim">正在检索 Semantic Scholar…</div>}
            {s.schErr && <div className="p-3 text-xs text-red-400">{s.schErr}</div>}
            {s.results && s.results.length === 0 && <div className="p-3 text-xs text-txt-dim">没有结果，换个关键词试试</div>}
            {s.results?.map((h, i) => (
              <div key={i} className="mb-2 rounded-lg border border-line bg-bg-card p-2.5 text-xs leading-5">
                <div className="font-medium">{h.title}</div>
                <div className="mt-0.5 text-[11px] text-txt-dim">
                  {h.authors || '佚名'} · {h.year ?? '—'} · {h.venue || '—'} · 被引 {h.cited}
                </div>
                {h.abstract && <div className="mt-1 text-[11px] leading-4 text-txt-dim">{truncate(h.abstract, 160)}…</div>}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90" onClick={() => void s.continueSearch(h.title)}>
                    继续搜索
                  </button>
                  <button
                    className="rounded border border-line px-2 py-0.5 hover:bg-bg-hover"
                    onClick={() =>
                      eventBus.emit('ai:explain', {
                        text: `${h.title}（${h.authors}，${h.year ?? ''}）摘要：${h.abstract || '无'}`,
                        paperId: activePaperId ?? undefined
                      })
                    }
                  >
                    AI 摘要
                  </button>
                  <button
                    className="rounded border border-line px-2 py-0.5 hover:bg-bg-hover"
                    title="翻译标题与摘要"
                    onClick={() => void translate(`${h.title}\n\n${h.abstract || ''}`.trim())}
                  >
                    译
                  </button>
                  <button className="rounded bg-green-600/80 px-2 py-0.5 text-white hover:opacity-90" onClick={() => setAnsEditor({ text: h.abstract ? `${h.title} — ${truncate(h.abstract, 220)}` : h.title, src: h.url })}>
                    收为答案
                  </button>
                  <button
                    className="rounded-md border border-line px-2 py-0.5 text-txt-dim hover:border-accent hover:text-accent"
                    onClick={() => void lh.openExternal(h.url)}
                  >
                    打开 ↗
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : s.src ? (
          <webview
            ref={attachWeb}
            key={s.wvPreload || 'noload'} // preload 到位后强制重挂载，避免属性晚到不生效
            src={s.src}
            preload={s.wvPreload || undefined}
            className="h-full w-full border-0"
            allowpopups="true"
          />
        ) : (
          <div className="p-4 text-xs leading-6 text-txt-dim">
            在论文中选中文字点「搜索」即可搜索并绑定原文；也可直接输入关键词。
            <br />
            在网页里再选中不懂的词点「继续搜索」，会展开成主界面并挂到导图分叉；找到答案就选中它点「收为答案」，编辑后一键标记归档。
          </div>
        )}

        {/* 右键快捷菜单（webview / 学术结果内选中文字后右键） */}
        {ctxMenu && (
          <>
            <div className="fixed inset-0 z-10" onMouseDown={() => setCtxMenu(null)} />
            <div
              className="fixed z-20 w-44 rounded-lg border border-line bg-bg-card p-1 shadow-xl"
              style={{
                left: Math.max(4, Math.min(ctxMenu.x, window.innerWidth - 190)),
                top: Math.max(4, Math.min(ctxMenu.y, window.innerHeight - 230))
              }}
            >
              {ctxMenu.text ? (
                [
                  {
                    k: 'search',
                    label: map && cur ? '继续搜索（下一层）' : '搜索',
                    run: () => void (map && cur ? s.continueSearch(ctxMenu.text) : s.doSearch(ctxMenu.text))
                  },
                  {
                    k: 'ai',
                    label: 'AI 解释',
                    run: () => {
                      setSidebarTab('ai')
                      eventBus.emit('ai:explain', { text: ctxMenu.text, paperId: activePaperId ?? undefined })
                    }
                  },
                  { k: 'tr', label: '翻译', run: () => void translate(ctxMenu.text) },
                  { k: 'ans', label: '收为答案', run: () => setAnsEditor({ text: ctxMenu.text, x: ctxMenu.x, y: ctxMenu.y }) },
                  { k: 'cp', label: '复制', run: () => void lh.clipboardWrite(ctxMenu.text) }
                ].map((it) => (
                  <button
                    key={it.k}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-bg-hover"
                    onClick={() => {
                      it.run()
                      setCtxMenu(null)
                    }}
                  >
                    {it.label}
                  </button>
                ))
              ) : (
                <div className="px-2 py-1.5 text-xs leading-5 text-txt-dim">先选中网页文字，再右键唤出搜索 / 解释菜单</div>
              )}
            </div>
          </>
        )}

        {/* 收为答案：编辑后一键「原文绿色标记 + 归档」 */}
        {ansEditor && (
          <>
            <div className="fixed inset-0 z-30" onMouseDown={() => setAnsEditor(null)} />
            <div
              className="fixed z-40 w-80 rounded-xl border border-line bg-bg-card p-3 shadow-xl"
              style={
                ansEditor.x !== undefined && ansEditor.y !== undefined
                  ? { left: Math.max(4, Math.min(ansEditor.x, window.innerWidth - 330)), top: Math.max(4, Math.min(ansEditor.y, window.innerHeight - 230)) }
                  : { left: '50%', top: '38%', transform: 'translate(-50%, -50%)' }
              }
            >
              <div className="mb-1.5 flex items-baseline gap-1.5 text-xs font-medium">
                <span>收为答案</span>
                <span className="text-[10px] font-normal text-txt-dim">编辑内容 → 一键在原文打绿色标记并归档</span>
              </div>
              <textarea
                className="h-28 w-full resize-none rounded-lg border border-line bg-bg p-2 text-xs leading-5"
                value={ansEditor.text}
                onChange={(e) => setAnsEditor({ ...ansEditor, text: e.target.value })}
                autoFocus
              />
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:opacity-90"
                  onClick={() => {
                    const t = ansEditor.text.trim()
                    if (!t) return
                    // 归档答案 + 原文标记升级/补标都在 markAnswer 内完成
                    void s.markAnswer(t, ansEditor.src)
                    setAnsEditor(null)
                  }}
                >
                  标记并设为答案
                </button>
                <button className="rounded border border-line px-2 py-1 text-xs hover:bg-bg-hover" onClick={() => setAnsEditor(null)}>
                  取消
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 底部操作条 */}
      {(s.src || overlay) && (
        <div className="flex items-center gap-2 border-t border-line p-2 text-xs">
          {map && cur && (
            <>
              <button className="rounded border border-line px-2 py-1 hover:bg-bg-hover disabled:opacity-50" disabled={s.aiBusy} onClick={() => void drill()}>
                {s.aiBusy ? '拆解中…' : 'AI 拆解本层'}
              </button>
              <button
                className="rounded border border-line px-2 py-1 text-red-400 hover:bg-red-500/10"
                onClick={() => {
                  const parent = cur.parentId ? map.nodes.find((n) => n.id === cur.parentId) : null
                  // 删层：连同其搜索历史记录一起清理，不残留过时历史
                  const removed = useMindmaps.getState().removeNode(map.id, cur.id)
                  void usePapers.getState().removeSearches(map.id, removed)
                  s.set({ curId: parent?.id ?? null, mapId: parent ? map.id : null })
                }}
                title="删除当前层及其下层"
              >
                删层
              </button>
            </>
          )}
          {s.src && (
            <span className="flex items-center gap-0.5 rounded border border-line px-1 py-0.5" title="网页缩放（适应窗口宽度）">
              <button className="px-1 text-txt-dim hover:text-accent" onClick={() => applyZoom(s.zoomF - 0.15)}>
                −
              </button>
              <span className="text-[10px] text-txt-dim">{Math.round(s.zoomF * 100)}%</span>
              <button className="px-1 text-txt-dim hover:text-accent" onClick={() => applyZoom(s.zoomF + 0.15)}>
                ＋
              </button>
            </span>
          )}
          {s.src && (
            <button className="ml-auto rounded border border-line px-2 py-1 hover:bg-bg-hover" onClick={() => void lh.openExternal(s.src)}>
              浏览器打开
            </button>
          )}
        </div>
      )}

      {/* 历史链路与本文搜索记录已合并进上方链路导图：点击导图节点即回到该层搜索 */}
    </div>
  )
}
