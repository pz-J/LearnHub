import { useState } from 'react'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { lh } from '@/lib/ipc'
import { DEFAULT_PERIODS, COURSE_COLORS } from '@/types'
import { syncNow } from '@/lib/sync'

/** 最近一次同步状态行（含自动同步） */
function SyncStatusLine() {
  const st = useSettings((s) => s.settings.syncState)
  if (!st?.lastAt) return <div className="mt-2 text-xs text-txt-dim">尚未同步过。配置后点「立即同步」建立远端仓库。</div>
  const at = new Date(st.lastAt).toLocaleString()
  if (!st.ok) return <div className="mt-2 text-xs text-red-400">上次同步失败（{at}）：{st.error ?? '未知错误'}</div>
  return (
    <div className="mt-2 text-xs text-txt-dim">
      上次同步 {at}：推送 {st.pushed ?? 0} / 拉取 {st.pulled ?? 0}
      {(st.conflicts ?? 0) > 0 && <span className="text-amber-400"> / 冲突合并 {st.conflicts}</span>}
      {st.pulled ? '（拉取内容已自动重载）' : ''}
    </div>
  )
}

/** 设置页：AI / GitHub 同步 / 学期与节次 / 开发者选项 */
export function SettingsView() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const toast = useUi((s) => s.toast)
  const [testing, setTesting] = useState<'ai' | 'gh' | null>(null)
  const [aiDraft, setAiDraft] = useState(settings.ai)
  const [ghDraft, setGhDraft] = useState(settings.github)

  const testAi = async () => {
    setTesting('ai')
    try {
      await update({ ai: aiDraft })
      const res = await fetch(`${aiDraft.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiDraft.apiKey}` },
        body: JSON.stringify({ model: aiDraft.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast('AI 连接成功', 'ok')
    } catch (e) {
      toast('AI 连接失败：' + (e as Error).message, 'error')
    } finally {
      setTesting(null)
    }
  }

  const testGh = async () => {
    setTesting('gh')
    try {
      await update({ github: ghDraft })
      const user = (await lh.ghGetUser(ghDraft.pat)) as { login?: string; message?: string }
      if (user.login) toast(`GitHub 验证成功：${user.login}`, 'ok')
      else toast('GitHub 验证失败：' + (user.message ?? '未知错误'), 'error')
    } catch (e) {
      toast('GitHub 验证失败：' + (e as Error).message, 'error')
    } finally {
      setTesting(null)
    }
  }

  const doSync = async () => {
    await update({ github: ghDraft })
    const r = await syncNow()
    if (!r.ok) toast(r.error ?? '同步失败', 'error')
    else toast(`同步完成：推送 ${r.pushed} · 拉取 ${r.pulled}${r.repoCreated ? '（已自动建仓）' : ''}`, 'ok')
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-5 text-lg font-semibold">设置</h1>

      {/* AI */}
      <section className="mb-5 rounded-xl border border-line bg-bg-card p-5">
        <div className="mb-3 font-medium">AI（OpenAI 兼容接口，Key 仅存本地 settings.json，绝不上传同步）</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-txt-dim">
            Base URL
            <input
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              value={aiDraft.baseURL}
              onChange={(e) => setAiDraft({ ...aiDraft, baseURL: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
          </label>
          <label className="text-xs text-txt-dim">
            API Key
            <input
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              type="password"
              value={aiDraft.apiKey}
              onChange={(e) => setAiDraft({ ...aiDraft, apiKey: e.target.value })}
              placeholder="sk-…"
            />
          </label>
          <label className="text-xs text-txt-dim">
            模型
            <input
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              value={aiDraft.model}
              onChange={(e) => setAiDraft({ ...aiDraft, model: e.target.value })}
              placeholder="deepseek-chat"
            />
          </label>
        </div>
        <button className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-sm text-white disabled:opacity-50" disabled={testing === 'ai'} onClick={() => void testAi()}>
          {testing === 'ai' ? '测试中…' : '保存并测试连接'}
        </button>
      </section>

      {/* GitHub */}
      <section className="mb-5 rounded-xl border border-line bg-bg-card p-5">
        <div className="mb-3 font-medium">GitHub 一键同步（PAT 建议仅授予 repo 权限；仓库不存在会自动创建私有仓）</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-txt-dim">
            Personal Access Token
            <input
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              type="password"
              value={ghDraft.pat}
              onChange={(e) => setGhDraft({ ...ghDraft, pat: e.target.value })}
              placeholder="ghp_…"
            />
          </label>
          <label className="text-xs text-txt-dim">
            用户名 / 组织
            <input
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              value={ghDraft.owner}
              onChange={(e) => setGhDraft({ ...ghDraft, owner: e.target.value })}
              placeholder="your-name"
            />
          </label>
          <label className="text-xs text-txt-dim">
            仓库名
            <input
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              value={ghDraft.repo}
              onChange={(e) => setGhDraft({ ...ghDraft, repo: e.target.value })}
              placeholder="learnhub-data"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="rounded-lg border border-line px-4 py-1.5 text-sm hover:bg-bg-hover disabled:opacity-50" disabled={testing === 'gh'} onClick={() => void testGh()}>
            {testing === 'gh' ? '验证中…' : '验证并保存'}
          </button>
          <button className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:opacity-90" onClick={() => void doSync()}>
            立即同步
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-txt-dim">
            自动同步
            <select
              className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
              value={String(settings.github.autoSync ?? 0)}
              onChange={(e) => void update({ github: { ...settings.github, autoSync: Number(e.target.value) } })}
            >
              <option value="0">关闭</option>
              <option value="5">每 5 分钟</option>
              <option value="15">每 15 分钟</option>
              <option value="30">每 30 分钟</option>
            </select>
          </label>
        </div>
        <SyncStatusLine />
        <div className="mt-2 text-xs text-txt-dim">同步范围：data/ 下全部学习数据（JSON/Markdown）+ 模块存储打包（module-storage.json 单文件）。不含 PDF 原件、API Key、模块代码与授权记录。</div>
      </section>

      {/* 学期 */}
      <section className="mb-5 rounded-xl border border-line bg-bg-card p-5">
        <div className="mb-3 font-medium">学期设置</div>
        <label className="text-xs text-txt-dim">
          学期第一周周一（课表第 1 周的周一日期）
          <input
            type="date"
            className="mt-1 block w-56 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
            value={settings.schedule.semesterStart}
            onChange={(e) => void update({ schedule: { ...settings.schedule, semesterStart: e.target.value } })}
          />
        </label>
        <div className="mt-3 text-xs text-txt-dim">节次时间表：{settings.schedule.periods.length} 节（默认 12 节，可在 data/schedule.json 微调）</div>
        <button
          className="mt-2 rounded border border-line px-3 py-1 text-xs hover:bg-bg-hover"
          onClick={() => void update({ schedule: { ...settings.schedule, periods: DEFAULT_PERIODS } })}
        >
          恢复默认节次
        </button>
      </section>

      {/* 外观 */}
      <section className="mb-5 rounded-xl border border-line bg-bg-card p-5">
        <div className="mb-3 font-medium">外观（模块也可经 ui.theme API 调整同样参数）</div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-txt-dim">主题色</span>
          {COURSE_COLORS.map((c) => (
            <button
              key={c}
              className={`h-6 w-6 rounded-full border-2 ${(settings.appearance?.accent ?? '#5b8cff') === c ? 'border-txt' : 'border-transparent'}`}
              style={{ background: c }}
              title={c}
              onClick={() => void update({ appearance: { ...(settings.appearance ?? { radius: 10, fontScale: 1 }), accent: c } })}
            />
          ))}
          <input
            type="color"
            className="h-6 w-8 cursor-pointer border border-line bg-bg"
            value={settings.appearance?.accent ?? '#5b8cff'}
            onChange={(e) => void update({ appearance: { ...(settings.appearance ?? { radius: 10, fontScale: 1 }), accent: e.target.value } })}
            title="自定义主题色"
          />
        </div>
        <label className="mb-2 block text-xs text-txt-dim">
          圆角：{settings.appearance?.radius ?? 10}px
          <input
            type="range"
            className="mt-1 block w-64 accent-accent"
            min={2}
            max={20}
            step={1}
            value={settings.appearance?.radius ?? 10}
            onChange={(e) => void update({ appearance: { ...(settings.appearance ?? { accent: '#5b8cff', fontScale: 1 }), radius: Number(e.target.value) } })}
          />
        </label>
        <label className="block text-xs text-txt-dim">
          界面缩放：{Math.round((settings.appearance?.fontScale ?? 1) * 100)}%
          <input
            type="range"
            className="mt-1 block w-64 accent-accent"
            min={0.85}
            max={1.3}
            step={0.05}
            value={settings.appearance?.fontScale ?? 1}
            onChange={(e) =>
              void update({ appearance: { ...(settings.appearance ?? { accent: '#5b8cff', radius: 10 }), fontScale: Number(e.target.value) } })
            }
          />
        </label>
      </section>

      {/* 其他 */}
      <section className="rounded-xl border border-line bg-bg-card p-5">
        <div className="mb-3 font-medium">其他</div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-accent"
            checked={settings.devMode}
            onChange={(e) => void update({ devMode: e.target.checked })}
          />
          开发者模式（模块中心显示开发提示）
        </label>
        <div className="mt-3 flex gap-2">
          <button className="rounded border border-line px-3 py-1.5 text-xs hover:bg-bg-hover" onClick={() => void lh.openDataDir()}>
            打开数据目录
          </button>
          <button className="rounded border border-line px-3 py-1.5 text-xs hover:bg-bg-hover" onClick={() => void lh.openModStorageDir()}>
            打开模块目录
          </button>
        </div>
      </section>
    </div>
  )
}
