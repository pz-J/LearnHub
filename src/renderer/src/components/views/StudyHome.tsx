import { useMemo, useState } from 'react'
import { usePapers } from '@/stores/papers'
import { useTodos } from '@/stores/todos'
import { useFlashcards } from '@/stores/flashcards'
import { useFocus } from '@/stores/misc'
import { useMindmaps } from '@/stores/mindmaps'
import { useNotes } from '@/stores/notes'
import { ACHIEVEMENT_DEFS, useAchievements } from '@/stores/achievements'
import { useUi } from '@/stores/ui'
import { useRegistry } from '@/kernel/registry'
import { today, fmtTime, truncate } from '@/lib/utils'

function ActionCard({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex min-h-[94px] min-w-0 items-start gap-3 rounded-xl border border-line/90 bg-bg-card/80 p-3.5 text-left shadow-sm shadow-black/5 transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:bg-bg-hover hover:shadow-lg hover:shadow-black/10">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/10 bg-accent/10 text-lg text-accent transition-colors group-hover:bg-accent/15">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold tracking-tight group-hover:text-accent">{title}</span><span className="mt-1 block text-xs leading-5 text-txt-dim">{desc}</span></span>
      <span aria-hidden="true" className="mt-0.5 text-base text-txt-dim transition-transform group-hover:translate-x-0.5 group-hover:text-accent">↗</span>
    </button>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-xl border border-white/[0.06] bg-bg/55 p-3.5 backdrop-blur-sm"><div className="text-[11px] font-medium tracking-wide text-txt-dim">{label}</div><div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</div><div className="mt-1 text-[11px] leading-4 text-txt-dim">{hint}</div></div>
}

/** Unified research home: make the next useful action obvious without replacing the user's existing workflows. */
export function StudyHome() {
  const papers = usePapers((s) => s.papers)
  const order = usePapers((s) => s.order)
  const todos = useTodos((s) => s.items)
  const toggleTodo = useTodos((s) => s.toggle)
  const cards = useFlashcards((s) => s.items)
  const sessions = useFocus((s) => s.sessions)
  const maps = useMindmaps((s) => s.maps)
  const notes = useNotes((s) => s.notes)
  const modules = useRegistry((s) => s.modules)
  const claimedIds = useAchievements((s) => s.claimedIds)
  const customTasks = useAchievements((s) => s.customTasks)
  const openPaper = useUi((s) => s.openPaper)
  const openNote = useUi((s) => s.openNote)
  const navigate = useUi((s) => s.navigate)
  const toast = useUi((s) => s.toast)
  const [taskInput, setTaskInput] = useState('')
  const [taskSaving, setTaskSaving] = useState(false)
  const [taskError, setTaskError] = useState('')
  const addTodo = useTodos((s) => s.add)

  const date = today()
  const paperList = useMemo(() => order.map((id) => papers[id]).filter(Boolean), [order, papers])
  const recentPapers = useMemo(() => [...paperList].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 4), [paperList])
  const recentNotes = useMemo(() => Object.values(notes).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 3), [notes])
  const unfinished = paperList.filter((p) => !p.finished)
  const continuePaper = unfinished.length ? [...unfinished].sort((a, b) => b.updatedAt - a.updatedAt)[0] : recentPapers[0]
  const dueCards = cards.filter((c) => c.due <= date).length
  const openTodos = todos.filter((t) => !t.done && t.date <= date).sort((a, b) => (a.date + (a.time || '23:59')).localeCompare(b.date + (b.time || '23:59'))).slice(0, 4)
  const doneToday = todos.filter((t) => t.done && t.updatedAt >= new Date(date + 'T00:00:00').getTime()).length
  const todayFocus = sessions.filter((s) => new Date(s.end).toDateString() === new Date().toDateString()).reduce((n, s) => n + s.minutes, 0)
  const progress = useMemo(() => useAchievements.getState().progress(), [papers, todos, sessions, maps, notes, cards, claimedIds, customTasks])
  const claimable = ACHIEVEMENT_DEFS.filter((d) => !claimedIds.includes(d.id) && progress[d.metric] >= d.target)
  const nextAchievement = ACHIEVEMENT_DEFS.filter((d) => !claimedIds.includes(d.id) && progress[d.metric] < d.target).map((d) => ({ ...d, current: progress[d.metric] || 0, ratio: (progress[d.metric] || 0) / d.target })).sort((a, b) => b.ratio - a.ratio)[0]

  const createTask = async () => {
    const title = taskInput.trim()
    if (!title || taskSaving) return
    setTaskSaving(true)
    setTaskError('')
    try {
      await addTodo({ title, date })
      setTaskInput('')
    } catch (error) {
      setTaskError((error as Error).message || '保存失败，请重试')
    } finally {
      setTaskSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1440px] space-y-6 p-4 sm:p-5 lg:space-y-7 lg:p-8">
        <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[radial-gradient(ellipse_at_88%_12%,rgb(var(--lh-accent-rgb)_/_0.17),transparent_42%),linear-gradient(135deg,#1b202e_0%,#171b27_55%,#141821_100%)] p-5 shadow-xl shadow-black/10 md:rounded-3xl md:p-7 lg:p-8">
          <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 right-[28%] h-px w-1/3 bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgb(var(--lh-accent-rgb)_/_0.8)]" /> LEARNHUB <span className="text-txt-dim/70">/</span> RESEARCH DESK</div>
              <h1 className="mt-4 text-[1.7rem] font-semibold leading-tight tracking-tight md:text-3xl lg:text-[2.1rem]">把阅读，变成真正的理解。</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-txt-dim md:text-[13px]">从一篇论文开始：标记关键证据、沿着问题继续搜索，再把理解沉淀成笔记和复习卡片。不必一次做完，下一步就够了。</p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <button className="lh-button lh-button-primary min-h-10 px-4" onClick={() => continuePaper ? openPaper(continuePaper.id) : navigate('library')}>{continuePaper ? '继续阅读' : '导入第一篇论文'} <span aria-hidden="true">→</span></button>
                <button className="lh-button" onClick={() => navigate('mod:core.achievements:achievements')}>查看成就大楼</button>
              </div>
            </div>
            <div className="grid min-w-[220px] flex-1 grid-cols-2 gap-2.5 sm:max-w-[390px]">
              <Metric label="文献库" value={String(paperList.length)} hint={`${unfinished.length} 篇尚未标记读完`} />
              <Metric label="待复习闪卡" value={String(dueCards)} hint={dueCards ? '花几分钟巩固记忆' : '今天暂时没有到期卡片'} />
              <Metric label="今日专注" value={`${Math.floor(todayFocus / 60)}h ${todayFocus % 60}m`} hint="只统计已完成的专注时段" />
              <Metric label="今日完成待办" value={String(doneToday)} hint={`${openTodos.length} 项待办待处理`} />
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3.5 flex items-end justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">YOUR WORKFLOW</div><h2 className="mt-1 text-base font-semibold tracking-tight">接下来做什么</h2><p className="mt-1 text-xs text-txt-dim">把常用动作放在手边，减少在模块间来回寻找。</p></div></div>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <ActionCard icon="⌕" title="论文精读" desc="打开文献库，继续标记、解释与追问" onClick={() => continuePaper ? openPaper(continuePaper.id) : navigate('library')} />
            <ActionCard icon="✧" title="精读向导" desc={modules['com.learnhub.paper-guide']?.enabled ? '把标记与问答整理成结构化导读' : '安装后可把标记与问答整理成导读'} onClick={() => navigate(modules['com.learnhub.paper-guide']?.enabled ? 'mod:com.learnhub.paper-guide:paper-guide' : 'hub')} />
            <ActionCard icon="▤" title="复习闪卡" desc={dueCards ? `${dueCards} 张卡片等待复习` : '从论文标记制作卡片，建立长期记忆'} onClick={() => navigate(modules['core.flashcards']?.enabled ? 'mod:core.flashcards:flashcards' : 'hub')} />
            <ActionCard icon="⌘" title="学习模块" desc="探索复习规划、生词本、导出等工具" onClick={() => navigate('hub')} />
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.8fr)]">
          <section className="lh-panel min-w-0 p-4">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">最近阅读</h2><p className="mt-1 text-xs text-txt-dim">自动按最近更新排序；点击即可回到论文。</p></div><button className="lh-button" onClick={() => navigate('library')}>全部文献 →</button></div>
            {recentPapers.length ? <div className="mt-3 divide-y divide-line">{recentPapers.map((p) => <button key={p.id} onClick={() => openPaper(p.id)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-bg-hover/60"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg text-lg">{p.finished ? '✓' : '▤'}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.title}</span><span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-txt-dim"><span>{(p.highlights ?? []).length} 处标记</span><span>{(p.answers ?? []).length} 条摘录问答</span><span>{fmtTime(p.updatedAt)}</span></span></span><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${p.finished ? 'bg-green-500/10 text-green-400' : 'bg-accent/10 text-accent'}`}>{p.finished ? '已读完' : '继续读'}</span></button>)}</div> : <div className="lh-empty-state mt-3"><div className="text-2xl">▤</div><div className="mt-2 font-medium text-txt">你的研究空间从第一篇论文开始</div><p className="mt-1">导入 PDF 后，高亮、搜索链路、问答与导读都会围绕这篇论文沉淀。</p><button className="lh-button lh-button-primary mt-3" onClick={() => navigate('library')}>前往文献库</button></div>}
            <div className="mt-4 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">最近研究记录</h3><button className="text-xs text-accent hover:underline" onClick={() => navigate('notes')}>全部笔记 →</button></div>
              {recentNotes.length ? <div className="mt-2 space-y-1">{recentNotes.map((note) => <button key={note.id} onClick={() => openNote(note.id)} className="block w-full rounded-lg px-2 py-2 text-left hover:bg-bg-hover"><span className="block truncate text-sm">{note.title || '未命名笔记'}</span><span className="mt-0.5 block truncate text-xs text-txt-dim">{note.paperId && papers[note.paperId] ? `${papers[note.paperId].title} · ` : ''}{truncate(String(note.body ?? '').replace(/[#>*\n]/g, ' ').trim(), 90) || '空笔记'} · {fmtTime(note.updatedAt)}</span></button>)}</div> : <p className="mt-2 rounded-lg bg-bg p-3 text-xs leading-5 text-txt-dim">保存 AI 解释或整理自己的研究问题后，记录会出现在这里。</p>}
            </div>
          </section>

          <section className="space-y-4">
            <div className="lh-panel p-4">
              <div className="flex items-center justify-between"><h2 className="text-base font-semibold">今日待办</h2><button className="text-xs text-accent hover:underline" onClick={() => navigate('calendar')}>日历 →</button></div>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void createTask() }}><input className="lh-input min-w-0" value={taskInput} onChange={(e) => { setTaskInput(e.target.value); setTaskError('') }} placeholder="记下一件下一步要做的事…" /><button className="lh-button lh-button-primary shrink-0" type="submit" disabled={!taskInput.trim() || taskSaving}>{taskSaving ? '保存中…' : '添加'}</button></form>
              {taskError && <div className="mt-2 flex items-center gap-2 text-xs text-red-400" role="alert"><span className="min-w-0 flex-1">待办保存失败：{taskError}</span><button className="underline" onClick={() => void createTask()}>重试</button></div>}
              {openTodos.length ? <div className="mt-2 space-y-1">{openTodos.map((t) => <div key={t.id} className="flex items-start gap-2 rounded-lg px-1 py-2 hover:bg-bg-hover"><input aria-label={`完成待办：${t.title}`} type="checkbox" className="mt-1 accent-[rgb(var(--lh-accent-rgb))]" checked={t.done} onChange={() => void toggleTodo(t.id).catch((error) => toast(`更新待办失败：${(error as Error).message || '请重试'}`, 'error'))} /><div className="min-w-0 flex-1"><div className="text-sm leading-5">{t.title}</div><div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-txt-dim"><span>{t.date < date ? '已逾期 · ' : ''}{t.date}{t.time ? ` ${t.time}` : ''}</span>{t.sourcePage && <span>来源 P{t.sourcePage}</span>}{t.sourceNoteId && <button className="text-accent hover:underline" onClick={() => openNote(t.sourceNoteId!)}>回到研究笔记 →</button>}{t.sourcePaperId && !t.sourceNoteId && <button className="text-accent hover:underline" onClick={() => openPaper(t.sourcePaperId!)}>回到论文 →</button>}</div></div></div>)}</div> : <div className="mt-3 rounded-lg bg-bg p-3 text-xs leading-5 text-txt-dim">暂时没有逾期或今天的未完成待办。可以在研究笔记中把问题或结论转为后续行动。</div>}
            </div>

            <div className="lh-panel p-4">
              <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold">成就进度</h2><button className="text-xs text-accent hover:underline" onClick={() => navigate('mod:core.achievements:achievements')}>进入大楼 →</button></div>
              {claimable.length ? <button onClick={() => navigate('mod:core.achievements:achievements')} className="mt-3 w-full rounded-lg border border-accent/40 bg-accent/10 p-3 text-left"><div className="text-sm font-medium text-accent">有 {claimable.length} 项成就可以领取</div><div className="mt-1 text-xs text-txt-dim">你的学习成果已达标，去选一块积木，继续搭建大楼。</div></button> : nextAchievement ? <div className="mt-3"><div className="flex items-start justify-between gap-2"><div className="text-sm font-medium">{nextAchievement.title}</div><div className="text-xs text-txt-dim">{Math.min(nextAchievement.current, nextAchievement.target)}/{nextAchievement.target}</div></div><p className="mt-1 text-xs text-txt-dim">{nextAchievement.desc}</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-hover"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, nextAchievement.ratio * 100)}%` }} /></div></div> : <p className="mt-3 text-sm text-txt-dim">全部内置成就都已领取，真棒！可以继续用自定义任务记录自己的研究目标。</p>}
              <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-lg bg-bg p-2.5"><div className="text-xs text-txt-dim">已读完论文</div><div className="mt-1 text-lg font-semibold">{paperList.filter((p) => p.finished).length}<span className="ml-1 text-xs font-normal text-txt-dim">/ {paperList.length}</span></div></div><div className="rounded-lg bg-bg p-2.5"><div className="text-xs text-txt-dim">已完成自定义任务</div><div className="mt-1 text-lg font-semibold">{customTasks.filter((t) => t.done).length}<span className="ml-1 text-xs font-normal text-txt-dim">/ {customTasks.length}</span></div></div></div>
            </div>
          </section>
        </div>

        <footer className="pb-2 text-center text-[11px] text-txt-dim">本地优先 · 阅读、标记与笔记留在你的设备上 · 今天完成一点，也是在积累</footer>
      </div>
    </div>
  )
}
