import { useMemo, useState } from 'react'
import { usePapers } from '@/stores/papers'
import { useNotes } from '@/stores/notes'
import { useReaderState } from '@/stores/readerState'
import { useUi } from '@/stores/ui'
import { eventBus, EVENTS } from '@/kernel/eventBus'
import { lh } from '@/lib/ipc'
import { truncate } from '@/lib/utils'

/** 笔记侧边栏：聚合当前论文的高亮/批注/AI解释/搜索记录，与 PDF 双向联动 */
export function NotesPanel() {
  const activePaperId = useUi((s) => s.activePaperId)
  const paper = usePapers((s) => (activePaperId ? s.papers[activePaperId] : undefined))
  const notes = useNotes((s) => s.notes)
  const write = useNotes((s) => s.write)
  const setHover = useReaderState((s) => s.setHover)
  const toast = useUi((s) => s.toast)
  const [filter, setFilter] = useState('')

  const relatedNotes = useMemo(() => Object.values(notes).filter((n) => n.paperId === activePaperId), [notes, activePaperId])

  if (!paper) return <div className="p-4 text-sm text-txt-dim">打开论文后，这里会聚合该论文的所有高亮、批注与搜索记录。</div>

  const hls = paper.highlights.filter((h) => !filter || h.text.includes(filter) || (h.note ?? '').includes(filter))

  const saveToNote = () => {
    const lines: string[] = [`# ${paper.title}`, '', '## 高亮与批注', '']
    for (const h of paper.highlights) {
      lines.push(`> ${h.text}`)
      if (h.note) lines.push(`批注：${h.note}`)
      if (h.aiExplain) lines.push(`AI 解释：${h.aiExplain}`)
      lines.push('')
    }
    if (paper.searches.length) {
      lines.push('## 搜索记录', '')
      for (const s of paper.searches) lines.push(`- ${s.query}（${s.provider}）${s.boundText ? ` ← ${truncate(s.boundText, 40)}` : ''}`)
    }
    void write(null, { title: `${paper.title} · 摘录`, paperId: paper.id, body: lines.join('\n'), tags: ['摘录'] })
    toast('已保存为笔记（可在「笔记」页查看）', 'ok')
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <input
          className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs"
          placeholder="筛选高亮/批注…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="shrink-0 rounded bg-accent px-2.5 py-1 text-xs text-white hover:opacity-90" onClick={saveToNote}>
          存为笔记
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {hls.length === 0 && <div className="py-8 text-center text-xs text-txt-dim">尚无高亮。在论文中选中文字后选择颜色即可。</div>}
        {[...hls].reverse().map((h) => (
          <div
            key={h.id}
            className="cursor-pointer rounded-lg border border-line bg-bg-card p-2.5 text-xs hover:border-accent/50"
            onMouseEnter={() => setHover(h.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => eventBus.emit(EVENTS.scrollToHighlight, { paperId: paper.id, highlightId: h.id })}
          >
            <div className="flex items-start gap-1.5">
              <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
              <div className="min-w-0 flex-1">
                <div className="leading-5">{truncate(h.text, 90)}</div>
                {h.note && <div className="mt-1 rounded bg-bg-soft p-1.5 text-txt-dim">✎ {h.note}</div>}
                {h.aiExplain && <div className="mt-1 rounded bg-accent/10 p-1.5 text-accent">AI：{truncate(h.aiExplain, 80)}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {paper.searches.length > 0 && (
        <div className="max-h-36 shrink-0 overflow-y-auto border-t border-line p-2">
          <div className="mb-1 text-xs text-txt-dim">搜索记录（点击在搜索页回放）</div>
          {[...paper.searches].reverse().map((s) => (
            <div
              key={s.id}
              className="cursor-pointer rounded p-1.5 text-xs hover:bg-bg-hover"
              onClick={() => {
                useUi.getState().setSidebarTab('search')
                eventBus.emit('search:replay', s)
              }}
            >
              {truncate(s.query, 26)} {s.boundText ? <span className="text-txt-dim">↩ {truncate(s.boundText, 16)}</span> : null}
            </div>
          ))}
        </div>
      )}

      {relatedNotes.length > 0 && (
        <div className="max-h-36 shrink-0 overflow-y-auto border-t border-line p-2">
          <div className="mb-1 text-xs text-txt-dim">关联笔记</div>
          {relatedNotes.map((n) => (
            <div key={n.id} className="flex items-center gap-2 rounded p-1.5 text-xs hover:bg-bg-hover">
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              <button className="rounded-md border border-line px-1.5 py-0.5 text-txt-dim hover:border-accent hover:text-accent" onClick={() => void lh.clipboardWrite(n.body)}>
                复制
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
