import { useState } from 'react'
import type { Todo } from '@/types'
import { useTodos } from '@/stores/todos'
import { today } from '@/lib/utils'

export function TodoEditor({ todo, onClose }: { todo: Todo | null; onClose: () => void }) {
  const add = useTodos((s) => s.add)
  const update = useTodos((s) => s.update)
  const remove = useTodos((s) => s.remove)
  const [title, setTitle] = useState(todo?.title ?? '')
  const [date, setDate] = useState(todo?.date ?? today())
  const [time, setTime] = useState(todo?.time ?? '')
  const [priority, setPriority] = useState<Todo['priority']>(todo?.priority ?? 'mid')
  const [repeat, setRepeat] = useState<Todo['repeat']>(todo?.repeat ?? 'none')
  const [tags, setTags] = useState(todo?.tags.join(',') ?? '')

  const save = async () => {
    if (!title.trim()) return
    const patch = {
      title: title.trim(),
      date,
      time: time || undefined,
      priority,
      repeat,
      tags: tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    }
    if (todo) await update(todo.id, patch)
    else await add(patch)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[420px] rounded-xl border border-line bg-bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold">{todo ? '编辑待办' : '添加待办'}</h3>
        <div className="space-y-3 text-sm">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="待办标题"
            className="w-full rounded-lg border border-line bg-bg-soft px-3 py-2 outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-txt-dim">日期</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-line bg-bg-soft px-3 py-2 outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-txt-dim">时间（可选）</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-line bg-bg-soft px-3 py-2 outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-txt-dim">优先级</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Todo['priority'])}
                className="w-full rounded-lg border border-line bg-bg-soft px-3 py-2 outline-none"
              >
                <option value="high">高</option>
                <option value="mid">中</option>
                <option value="low">低</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-txt-dim">重复</label>
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as Todo['repeat'])}
                className="w-full rounded-lg border border-line bg-bg-soft px-3 py-2 outline-none"
              >
                <option value="none">不重复</option>
                <option value="daily">每日</option>
                <option value="weekly">每周</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-txt-dim">标签（逗号分隔）</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="如：作业,高数"
              className="w-full rounded-lg border border-line bg-bg-soft px-3 py-2 outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-between">
          {todo ? (
            <button
              className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
              onClick={async () => {
                await remove(todo.id)
                onClose()
              }}
            >
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-bg-hover" onClick={onClose}>
              取消
            </button>
            <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90" onClick={save}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
