import { useMemo, useState } from 'react'
import { usePapers } from '@/stores/papers'
import { useMindmaps } from '@/stores/mindmaps'
import { useSearch } from '@/stores/search'
import { useUi } from '@/stores/ui'
import { ChainMap } from './ChainMap'
import { eventBus, EVENTS } from '@/kernel/eventBus'
import { fmtTime, truncate } from '@/lib/utils'
import { lh } from '@/lib/ipc'
import { aiAsk } from '@/lib/ai'
import type { Highlight } from '@/types'

/**
 * 论文笔记视图（按论文收纳）：上方思维导图（搜索链路），下方每个标记字句的解释与搜索问答。
 * 用于：搜索展开主界面时的侧边栏 + 笔记页的论文分区。
 */
export function PaperNoteBody({ paperId }: { paperId?: string | null }) {
  const paper = usePapers((s) => (paperId ? s.papers[paperId] : undefined))
  const maps = useMindmaps((s) => s.maps)
  const openChainNode = useSearch((s) => s.openChainNode)
  const goBack = useSearch((s) => s.goBack)

  // 本文最新的搜索链路
  const map = useMemo(() => {
    if (!paper) return undefined
    return Object.values(maps)
      .filter((m) => m.paperId === paper.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  }, [maps, paper])

  const answers = useMemo(() => [...(paper?.answers ?? [])].sort((a, b) => b.createdAt - a.createdAt), [paper])
  const highlights = useMemo(() => [...(paper?.highlights ?? [])].sort((a, b) => b.createdAt - a.createdAt), [paper])

  // 解释/批注编辑（保存后自动同步到全文相同标记）
  const [editId, setEditId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [explainDraft, setExplainDraft] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  // 搜索问答的「答」内容编辑
  const [ansEditId, setAnsEditId] = useState<string | null>(null)
  const [ansDraft, setAnsDraft] = useState('')

  if (!paper) return <div className="p-4 text-xs text-txt-dim">未打开论文。从文献库双击一篇论文开始阅读与搜索。</div>

  const openEdit = (h: Highlight) => {
    setEditId(h.id)
    setNoteDraft(h.note ?? '')
    setExplainDraft(h.aiExplain ?? '')
  }

  const saveEdit = (hid: string) => {
    void usePapers.getState().updateHighlight(paper.id, hid, {
      note: noteDraft.trim() || undefined,
      aiExplain: explainDraft.trim() || undefined
    })
    setEditId(null)
  }

  const aiFill = async () => {
    const h = highlights.find((x) => x.id === editId)
    if (!h || aiBusy) return
    setAiBusy(true)
    try {
      const out = await aiAsk(
        `用中文解释论文中这段内容（是什么意思、为什么重要），简洁准确：\n\n${h.text}`,
        '你是论文阅读助手，输出面向大学生的中文解释。'
      )
      setExplainDraft(out)
    } catch (e) {
      useUi.getState().toast('AI 解释失败：' + (e as Error).message, 'error')
    } finally {
      setAiBusy(false)
    }
  }

  const jumpToHighlight = (h: Highlight) => {
    goBack() // 若在主界面模式，先收回侧边栏露出论文
    setTimeout(() => eventBus.emit(EVENTS.scrollToHighlight, { paperId: paper.id, highlightId: h.id }), 80)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 上：思维导图（本文搜索链路） */}
      <div className="border-b border-line px-2.5 py-1.5 text-xs">
        <span className="font-medium">搜索链路</span>
        <span className="ml-2 text-[10px] text-txt-dim">点击导图节点回到该层搜索</span>
      </div>
      {map ? (
        <ChainMap map={map} className="h-64 shrink-0 border-b border-line" onNodeClick={(n) => void openChainNode(map.id, n)} />
      ) : (
        <div className="border-b border-line px-3 py-2 text-[11px] leading-5 text-txt-dim">本文还没有搜索链路：阅读时选中文字点「搜索」即会在这里生成。</div>
      )}

      {/* 下：搜索问答 + 标记与解释 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {/* 搜索问答（收为答案的内容，折叠在各自问题下） */}
        {answers.length > 0 && (
          <>
            <div className="mb-1.5 text-xs font-medium text-txt-dim">搜索问答</div>
            <div className="mb-3 space-y-2">
              {answers.map((a) => (
                <div key={a.id} className="group rounded-lg border border-line bg-bg-card p-2.5 text-xs">
                  <div className="flex items-start gap-1.5">
                    <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">问</span>
                    <span className="min-w-0 flex-1 font-medium leading-5">{a.question}</span>
                    <button
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] ${ansEditId === a.id ? 'border-accent text-accent' : 'border-line text-txt-dim opacity-0 hover:border-accent hover:text-accent group-hover:opacity-100'}`}
                      onClick={() => {
                        if (ansEditId === a.id) setAnsEditId(null)
                        else {
                          setAnsEditId(a.id)
                          setAnsDraft(a.quote)
                        }
                      }}
                    >
                      {ansEditId === a.id ? '收起' : '编辑'}
                    </button>
                    <button
                      className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-txt-dim opacity-0 hover:border-red-400 hover:text-red-400 group-hover:opacity-100"
                      onClick={() => void usePapers.getState().removeAnswer(paper.id, a.id)}
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-start gap-1.5">
                    <span className="shrink-0 rounded bg-green-600/15 px-1.5 py-0.5 text-[10px] text-green-400">答</span>
                    {ansEditId === a.id ? (
                      <div className="min-w-0 flex-1">
                        <textarea
                          className="h-20 w-full resize-none rounded border border-line bg-bg p-2 text-[11px] leading-5"
                          value={ansDraft}
                          onChange={(e) => setAnsDraft(e.target.value)}
                          placeholder="编辑答案内容…"
                        />
                        <div className="mt-1 flex items-center gap-1.5">
                          <button
                            className="rounded bg-accent px-2.5 py-1 text-[11px] text-white hover:opacity-90"
                            onClick={() => {
                              void usePapers.getState().updateAnswer(paper.id, a.id, { quote: ansDraft.trim() || a.quote })
                              setAnsEditId(null)
                            }}
                          >
                            保存
                          </button>
                          <button className="rounded border border-line px-2 py-1 text-[11px] hover:bg-bg-hover" onClick={() => setAnsEditId(null)}>
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="min-w-0 flex-1 whitespace-pre-wrap leading-5 text-txt-dim">{a.quote}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-txt-dim">
                    <span>{fmtTime(a.createdAt)}</span>
                    {a.source && (
                      <button className="rounded-md border border-line px-1.5 py-0.5 hover:border-accent hover:text-accent" onClick={() => void lh.openExternal(a.source!)}>
                        来源 ↗
                      </button>
                    )}                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 标记与解释 */}
        <div className="mb-1.5 text-xs font-medium text-txt-dim">标记与解释（{highlights.length}）</div>
        {highlights.length === 0 && <div className="text-xs text-txt-dim">还没有标记。阅读时选中文字即可高亮、AI 解释、搜索绑定。</div>}
        <div className="space-y-2">
          {highlights.map((h) => (
            <div key={h.id} className="group rounded-lg border border-line bg-bg-card p-2.5 text-xs" style={{ borderLeft: `3px solid ${h.color}` }}>
              <div className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1 leading-5" title="点击回到原文">
                  <button className="text-left hover:text-accent" onClick={() => jumpToHighlight(h)}>
                    {truncate(h.text, 90)}
                  </button>
                </span>
                <span className="shrink-0 text-[10px] text-txt-dim">P{h.page}</span>
                <button
                  className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] ${editId === h.id ? 'border-accent text-accent' : 'border-line text-txt-dim opacity-0 hover:border-accent hover:text-accent group-hover:opacity-100'}`}
                  onClick={() => (editId === h.id ? setEditId(null) : openEdit(h))}
                >
                  {editId === h.id ? '收起' : '编辑'}
                </button>
              </div>

              {editId === h.id ? (
                <div className="mt-1.5 space-y-1.5">
                  <textarea
                    className="h-14 w-full resize-none rounded border border-line bg-bg p-2 text-[11px] leading-5"
                    placeholder="批注（可选）"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                  <textarea
                    className="h-28 w-full resize-none rounded border border-line bg-bg p-2 text-[11px] leading-5"
                    placeholder="解释内容（这段标记的理解/答案）"
                    value={explainDraft}
                    onChange={(e) => setExplainDraft(e.target.value)}
                  />
                  <div className="flex items-center gap-1.5">
                    <button className="rounded border border-line px-2 py-1 text-[11px] hover:bg-bg-hover disabled:opacity-50" disabled={aiBusy} onClick={() => void aiFill()}>
                      {aiBusy ? '生成中…' : 'AI 生成解释'}
                    </button>
                    <button className="rounded bg-accent px-2.5 py-1 text-[11px] text-white hover:opacity-90" onClick={() => saveEdit(h.id)}>
                      保存
                    </button>
                    <button className="rounded border border-line px-2 py-1 text-[11px] hover:bg-bg-hover" onClick={() => setEditId(null)}>
                      取消
                    </button>
                    <span className="ml-auto text-[10px] text-txt-dim">保存后同步到全文相同标记</span>
                  </div>
                </div>
              ) : (
                (h.note || h.aiExplain) && (
                  <div className="mt-1 space-y-1 whitespace-pre-wrap pl-1 text-[11px] leading-5 text-txt-dim">
                    {h.note && <div>✎ {h.note}</div>}
                    {h.aiExplain && <div><span className="text-txt-dim">AI·</span>{h.aiExplain}</div>}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
