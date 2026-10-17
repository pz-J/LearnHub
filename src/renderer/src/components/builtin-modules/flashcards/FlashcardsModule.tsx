import { useMemo, useState } from 'react'
import { useFlashcards } from '@/stores/flashcards'
import { usePapers } from '@/stores/papers'
import { useUi } from '@/stores/ui'
import { today, fmtTime, truncate } from '@/lib/utils'
import { aiAsk } from '@/lib/ai'
import type { Flashcard } from '@/types'

/** 内置子模块：闪卡间隔复习（SM-2），支持从论文高亮一键建卡 */
export function FlashcardsModule() {
  const cards = useFlashcards((s) => s.items)
  const add = useFlashcards((s) => s.add)
  const review = useFlashcards((s) => s.review)
  const remove = useFlashcards((s) => s.remove)
  const update = useFlashcards((s) => s.update)
  const papers = usePapers((s) => s.papers)
  const toast = useUi((s) => s.toast)

  const [tab, setTab] = useState<'review' | 'list'>('review')
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [flipped, setFlipped] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const due = useMemo(() => useFlashcards.getState().dueToday(), [cards])

  // 逐张复习队列
  const [idx, setIdx] = useState(0)
  const current = due[Math.min(idx, due.length - 1)]

  const onRate = async (quality: number) => {
    if (!current) return
    await review(current.id, quality)
    setFlipped(false)
    setIdx((i) => i + 1)
  }

  const createCard = async () => {
    if (!q.trim()) return toast('请输入问题', 'error')
    await add({ q: q.trim(), a: a.trim() })
    setQ('')
    setA('')
    toast('卡片已创建', 'ok')
  }

  const genAnswer = async (c: Flashcard) => {
    toast('AI 正在生成答案…')
    try {
      const ans = await aiAsk(
        `用不超过 80 字的中文回答这个知识点（来自论文学习）：\n${c.q}`,
        '你是学习助手，答案准确简洁。'
      )
      await update(c.id, { a: ans })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const sourceLabel = (c: Flashcard) => {
    if (!c.source) return ''
    const p = papers[c.source.paperId]
    return p ? `来自《${truncate(p.title, 16)}》` : ''
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">闪卡复习</h1>
        <span className="rounded-full bg-accent/20 px-3 py-1 text-xs text-accent">今日待复习 {due.length}</span>
        {(['review', 'list'] as const).map((t) => (
          <button
            key={t}
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? 'bg-accent text-white' : 'border border-line hover:bg-bg-hover'}`}
            onClick={() => setTab(t)}
          >
            {t === 'review' ? '复习' : '全部卡片'}
          </button>
        ))}
      </div>

      {tab === 'review' && (
        <div className="flex flex-1 flex-col items-center justify-center overflow-hidden">
          {!current ? (
            <div className="text-center text-txt-dim">
              <div className="mb-2 text-4xl">🎉</div>
              今日复习已完成！共 {cards.length} 张卡片
            </div>
          ) : (
            <div className="flex w-full max-w-xl flex-col">
              <div className="mb-2 text-xs text-txt-dim">
                第 {Math.min(idx + 1, due.length)} / {due.length} 张 · 到期 {current.due} {sourceLabel(current)}
              </div>
              <div
                className="min-h-40 cursor-pointer rounded-xl border border-line bg-bg-card p-6 text-base leading-7"
                onClick={() => setFlipped((f) => !f)}
              >
                <div className="mb-3 text-xs font-medium text-accent">问</div>
                {current.q}
                {flipped ? (
                  <>
                    <div className="mb-3 mt-5 text-xs font-medium text-green-400">答</div>
                    <div className="text-txt-dim">{current.a || '（暂无答案，可在「全部卡片」中编辑或用 AI 生成）'}</div>
                  </>
                ) : (
                  <div className="mt-4 text-xs text-txt-dim">点击卡片显示答案</div>
                )}
              </div>
              {flipped ? (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button className="rounded-lg border border-red-500/50 py-2 text-sm text-red-400 hover:bg-red-500/10" onClick={() => onRate(1)}>
                    忘记
                  </button>
                  <button className="rounded-lg border border-orange-500/50 py-2 text-sm text-orange-400 hover:bg-orange-500/10" onClick={() => onRate(3)}>
                    模糊
                  </button>
                  <button className="rounded-lg border border-green-500/50 py-2 text-sm text-green-400 hover:bg-green-500/10" onClick={() => onRate(5)}>
                    记住
                  </button>
                </div>
              ) : (
                <button className="mt-4 rounded-lg bg-accent py-2 text-sm text-white hover:opacity-90" onClick={() => setFlipped(true)}>
                  显示答案
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'list' && (
        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          <div className="rounded-xl border border-line bg-bg-card p-3">
            <div className="mb-2 text-sm font-medium">新建卡片</div>
            <textarea
              className="mb-2 w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm"
              rows={2}
              placeholder="问题（正面）"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <textarea
              className="mb-2 w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm"
              rows={2}
              placeholder="答案（背面，可留空稍后补）"
              value={a}
              onChange={(e) => setA(e.target.value)}
            />
            <button className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:opacity-90" onClick={createCard}>
              添加卡片
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto">
            {[...cards]
              .sort((x, y) => x.due.localeCompare(y.due))
              .map((c) => (
                <div key={c.id} className="rounded-xl border border-line bg-bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{c.q}</div>
                      {editingId === c.id ? (
                        <textarea
                          autoFocus
                          className="mt-2 w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm"
                          rows={3}
                          value={c.a}
                          onChange={(e) => void update(c.id, { a: e.target.value })}
                          onBlur={() => setEditingId(null)}
                        />
                      ) : (
                        <div className="mt-1 text-xs text-txt-dim">{c.a || '（无答案）'}</div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-txt-dim">
                        <span>到期 {c.due}</span>
                        <span>间隔 {c.interval} 天</span>
                        <span>复习 {c.reps} 次</span>
                        <span>EF {c.ef.toFixed(2)}</span>
                        {c.source && <span>{sourceLabel(c)}</span>}
                        <span>{fmtTime(c.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      {today() !== c.due + '' && null}
                      <button className="rounded border border-line px-2 py-0.5 text-xs hover:bg-bg-hover" onClick={() => setEditingId(c.id)}>
                        编辑
                      </button>
                      {!c.a && (
                        <button className="rounded border border-line px-2 py-0.5 text-xs text-accent hover:bg-bg-hover" onClick={() => void genAnswer(c)}>
                          AI 生成答案
                        </button>
                      )}
                      <button className="rounded border border-line px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10" onClick={() => void remove(c.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            {cards.length === 0 && (
              <div className="py-10 text-center text-sm text-txt-dim">
                还没有卡片。在论文阅读器选中文字 →「建卡」，或在这里手动创建。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
