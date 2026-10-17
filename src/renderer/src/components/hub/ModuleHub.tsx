import { useState } from 'react'
import { useRegistry } from '@/kernel/registry'
import { useGrants } from '@/kernel/grants'
import { CATALOG, LEVEL_LABEL, isCapability, type Capability } from '@/kernel/permissions'
import { validateManifest, type ModuleManifest } from '@/kernel/manifest'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { lh } from '@/lib/ipc'
import { cn } from '@/lib/utils'

const LEVEL_STYLE: Record<string, string> = {
  normal: 'border-accent/40 bg-accent/10 text-accent',
  sensitive: 'border-orange-500/50 bg-orange-500/10 text-orange-400',
  danger: 'border-red-500/60 bg-red-500/10 text-red-400'
}

/** 权限列表（安装确认页 / 详情共用） */
function PermList({ manifest, showOptional }: { manifest: ModuleManifest; showOptional: boolean }) {
  const groups: { level: string; caps: Capability[] }[] = [
    { level: 'danger', caps: [] },
    { level: 'sensitive', caps: [] },
    { level: 'normal', caps: [] }
  ]
  for (const p of manifest.permissions) {
    if (isCapability(p)) groups.find((g) => g.level === CATALOG[p].level)!.caps.push(p)
  }
  return (
    <div className="space-y-2">
      {groups.map(
        (g) =>
          g.caps.length > 0 && (
            <div key={g.level}>
              {g.level !== 'normal' && (
                <div className={cn('mb-1 text-xs font-medium', g.level === 'danger' ? 'text-red-400' : 'text-orange-400')}>
                  {LEVEL_LABEL[g.level as keyof typeof LEVEL_LABEL]}权限
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {g.caps.map((c) => (
                  <span key={c} className={cn('rounded-md border px-2 py-0.5 text-xs', LEVEL_STYLE[g.level])} title={CATALOG[c].desc}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )
      )}
      {showOptional && (manifest.optionalPermissions ?? []).length > 0 && (
        <div>
          <div className="mb-1 text-xs text-txt-dim">运行时可能申请（需逐次经元模块审批 + 你二次同意）</div>
          <div className="flex flex-wrap gap-1.5">
            {manifest.optionalPermissions!.map((c) => (
              <span key={c} className="rounded-md border border-dashed border-line px-2 py-0.5 text-xs text-txt-dim" title={isCapability(c) ? CATALOG[c].desc : ''}>
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** 模块管理中心：安装（权限二次同意）/ 启停 / 卸载 / 授权管理 */
export function ModuleHub() {
  const modules = useRegistry((s) => s.modules)
  const setEnabled = useRegistry((s) => s.setEnabled)
  const uninstallExternal = useRegistry((s) => s.uninstallExternal)
  const grants = useGrants((s) => s.grants)
  const revoke = useGrants((s) => s.revoke)
  const devMode = useSettings((s) => s.settings.devMode)
  const toast = useUi((s) => s.toast)
  const [pending, setPending] = useState<{ manifest: ModuleManifest; files: Record<string, string>; replacing: boolean } | null>(null)
  const [agree, setAgree] = useState(false)
  const [pendingBatch, setPendingBatch] = useState<{ manifest: ModuleManifest; files: Record<string, string>; replacing: boolean }[] | null>(null)
  const [batchAgree, setBatchAgree] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)

  const pickInstall = async () => {
    const r = (await lh.modulesPick()) as
      | { manifest: unknown; files: Record<string, string> }
      | { error: string }
      | null
    if (!r) return
    if ('error' in r) return toast(r.error, 'error')
    const v = validateManifest(r.manifest)
    if (!v.ok) return toast('清单校验失败：' + v.error, 'error')
    const existing = modules[v.manifest.id]
    if (existing?.source === 'builtin') return toast('不能用外部模块覆盖内置模块', 'error')
    setAgree(false)
    setPending({ manifest: v.manifest, files: r.files, replacing: !!existing })
  }

  const doInstall = async () => {
    if (!pending) return
    try {
      await useRegistry.getState().installExternal(pending.manifest, pending.files)
      toast(pending.replacing ? `已更新「${pending.manifest.name}」；额外权限需重新审批` : `已安装「${pending.manifest.name}」`, 'ok')
    } catch (e) {
      toast('安装失败：' + (e as Error).message, 'error')
    }
    setPending(null)
  }

  /** 批量导入：选父文件夹，扫描其中所有含 module.json 的子文件夹，统一审阅后一次安装 */
  const pickBatchInstall = async () => {
    const r = (await lh.modulesPickBatch()) as
      | { items: { folder: string; manifest: unknown; files: Record<string, string> }[]; errors: { folder: string; error: string }[]; scanned: number }
      | { error: string }
      | null
    if (!r) return
    if ('error' in r) return toast(r.error, 'error')
    const items: { manifest: ModuleManifest; files: Record<string, string>; replacing: boolean }[] = []
    const problems = r.errors.map((x) => `${x.folder}：${x.error}`)
    const seen = new Set<string>()
    for (const it of r.items) {
      const v = validateManifest(it.manifest)
      if (!v.ok) {
        problems.push(`${it.folder}：清单校验失败（${v.error}）`)
        continue
      }
      const existing = modules[v.manifest.id]
      if (existing?.source === 'builtin') {
        problems.push(`${it.folder}：不能用外部模块覆盖内置模块`)
        continue
      }
      if (seen.has(v.manifest.id)) {
        problems.push(`${it.folder}：模块 id 与前面条目重复（${v.manifest.id}）`)
        continue
      }
      seen.add(v.manifest.id)
      items.push({ manifest: v.manifest, files: it.files, replacing: !!existing })
    }
    if (!items.length) {
      const first = problems[0] ? '：' + problems[0] : r.scanned ? `，已扫描 ${r.scanned} 个文件夹但都不是有效模块` : ''
      return toast('没有可导入的模块' + first, 'error')
    }
    if (problems.length) toast(`${problems.length} 个文件夹被跳过：${problems[0]}${problems.length > 1 ? ' 等' : ''}`, 'error')
    setBatchAgree(false)
    setPendingBatch(items)
  }

  const doBatchInstall = async () => {
    if (!pendingBatch?.length) return
    setBatchBusy(true)
    let added = 0
    let updated = 0
    const fails: string[] = []
    for (const it of pendingBatch) {
      try {
        await useRegistry.getState().installExternal(it.manifest, it.files)
        if (it.replacing) updated += 1
        else added += 1
      } catch (e) {
        fails.push(`${it.manifest.name}（${(e as Error).message}）`)
      }
    }
    setBatchBusy(false)
    setPendingBatch(null)
    const summary = `批量导入完成：安装 ${added} · 更新 ${updated}`
    if (!fails.length) return toast(summary, 'ok')
    toast(`${summary} · 失败 ${fails.length}：${fails.slice(0, 2).join('；')}${fails.length > 2 ? ' 等' : ''}`, 'error')
  }

  const toggleModule = async (id: string, enabled: boolean) => {
    try {
      await setEnabled(id, enabled)
      toast(enabled ? '模块已启用' : '模块已停用', 'ok')
    } catch (e) {
      toast(`状态更新失败：${(e as Error).message || '未知错误'}`, 'error')
    }
  }

  const removeModule = async (id: string) => {
    try {
      await uninstallExternal(id)
      toast('模块已卸载；私有存储会保留', 'ok')
    } catch (e) {
      toast(`卸载失败：${(e as Error).message || '未知错误'}`, 'error')
    }
  }

  // ---------- 批量导入权限确认页 ----------
  if (pendingBatch) {
    const updateCount = pendingBatch.filter((x) => x.replacing).length
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="lh-panel mb-4 p-5">
          <div className="mb-1 text-xs text-txt-dim">
            批量导入确认 · 共 {pendingBatch.length} 个模块{updateCount ? `（其中 ${updateCount} 个为更新）` : ''}
          </div>
          <h1 className="text-xl font-semibold">批量导入模块</h1>
          <p className="mt-2 text-sm text-txt-dim">请逐个审阅以下模块申请的权限，确认后统一安装。任一模块失败不影响其余模块。</p>
        </div>

        {pendingBatch.map((it) => {
          const m = it.manifest
          const isMeta = m.type === 'meta'
          return (
            <div key={m.id} className="lh-panel mb-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.name}</span>
                <span className="text-xs text-txt-dim">v{m.version}</span>
                <span className="rounded bg-bg-soft px-1.5 py-0.5 text-xs text-txt-dim">{m.id}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-xs', isMeta ? 'bg-red-500/20 text-red-400' : 'bg-bg-soft text-txt-dim')}>
                  {isMeta ? '元模块' : '子模块'}
                </span>
                {it.replacing && <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-xs text-orange-400">更新</span>}
              </div>
              {m.description && <p className="mt-1 text-xs text-txt-dim">{m.description}</p>}
              <div className="mt-2">
                {m.permissions.length === 0 ? <div className="text-xs text-txt-dim">无需任何权限</div> : <PermList manifest={m} showOptional />}
              </div>
            </div>
          )
        })}

        <label className="my-4 flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-bg-card p-4 text-sm">
          <input type="checkbox" className="mt-1 accent-accent" checked={batchAgree} onChange={(e) => setBatchAgree(e.target.checked)} />
          <span>我已了解上述全部模块的权限含义与风险，同意批量安装。</span>
        </label>

        <div className="flex justify-end gap-2">
          <button className="lh-button" onClick={() => setPendingBatch(null)}>
            取消
          </button>
          <button
            className="lh-button lh-button-primary disabled:opacity-40"
            disabled={!batchAgree || batchBusy}
            onClick={() => void doBatchInstall()}
          >
            {batchBusy ? '正在导入…' : `同意并导入 ${pendingBatch.length} 个模块`}
          </button>
        </div>
      </div>
    )
  }

  // ---------- 安装权限确认页 ----------
  if (pending) {
    const m = pending.manifest
    const isMeta = m.type === 'meta'
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="lh-panel mb-4 p-5">
          <div className="mb-1 text-xs text-txt-dim">安装确认 · 请审阅该模块申请的权限</div>
          <h1 className="text-xl font-semibold">
            {m.name} <span className="ml-1 text-sm text-txt-dim">v{m.version}</span>
          </h1>
          <div className="mt-1 flex gap-2 text-xs text-txt-dim">
            <span className="rounded bg-bg-soft px-1.5 py-0.5">{m.id}</span>
            <span className={cn('rounded px-1.5 py-0.5', isMeta ? 'bg-red-500/20 text-red-400' : 'bg-bg-soft')}>
              {isMeta ? '元模块（母模块）' : '功能模块（子模块）'}
            </span>
            {m.author && <span>by {m.author}</span>}
          </div>
          {m.description && <p className="mt-3 text-sm text-txt-dim">{m.description}</p>}
        </div>

        {isMeta && (
          <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm leading-6 text-red-300">
            注意：这是一个<b>元模块</b>：它拥有高权限，可以代其他模块向宿主申请新能力（走特殊审批通道）。安装它意味着你信任其后续代为申请的权限行为——每次代申请仍会向你弹出确认。
          </div>
        )}

        <div className="lh-panel mb-4 p-5">
          <div className="mb-3 font-medium">申请的权限（安装后立即生效）</div>
          <PermList manifest={m} showOptional />
          {m.permissions.length === 0 && <div className="text-sm text-txt-dim">无需任何权限</div>}
          {m.network && (
            <div className="mt-3 text-xs text-txt-dim">网络白名单：{m.network.allowedHosts.join('、') || '无'}</div>
          )}
        </div>

        <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-bg-card p-4 text-sm">
          <input type="checkbox" className="mt-1 accent-accent" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            我已了解上述权限的含义与风险，同意安装{isMeta ? '并授予该元模块审批通道' : ''}。
          </span>
        </label>

        {pending.replacing && (
          <div className="mb-4 rounded-xl border border-orange-500/40 bg-orange-500/10 p-4 text-sm leading-6 text-orange-200">
            正在更新已安装模块。模块代码将被替换，私有存储会保留；此前授予的额外权限会清除，更新后的模块需要重新申请这些权限。
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="lh-button" onClick={() => setPending(null)}>
            取消
          </button>
          <button
            className="lh-button lh-button-primary disabled:opacity-40"
            disabled={!agree}
            onClick={() => void doInstall()}
          >
            {pending.replacing ? '同意并更新' : '同意并安装'}
          </button>
        </div>
      </div>
    )
  }

  // ---------- 模块列表 ----------
  const list = Object.values(modules).sort((a, b) => (a.source === b.source ? a.id.localeCompare(b.id) : a.source === 'builtin' ? -1 : 1))

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">模块管理中心</h1>
        <span className="text-xs text-txt-dim">内置 {list.filter((m) => m.source === 'builtin').length} · 外部 {list.filter((m) => m.source === 'external').length}</span>
        <button className="lh-button" onClick={() => void pickBatchInstall()}>
          批量导入
        </button>
        <button className="lh-button lh-button-primary" onClick={() => void pickInstall()}>
          安装模块
        </button>
      </div>

      {devMode && (
        <div className="mb-3 rounded-lg border border-dashed border-accent/50 bg-accent/5 p-3 text-xs leading-5 text-txt-dim">
          开发者模式已开启：修改项目 <code className="text-accent">modules/</code> 中的模块后，用「安装模块」重新选择其文件夹即可热更新（清单权限变更会重新走确认页）。
          <button className="ml-1 text-accent hover:underline" onClick={() => void lh.openModStorageDir()}>
            打开已安装模块目录
          </button>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto">
        {list.length === 0 && <div className="lh-empty-state">还没有可用模块。你可以安装一个模块，或先从 `modules/example-hello` 体验示例。</div>}
        {list.map((m) => {
          const isMeta = m.manifest.type === 'meta'
          const runtimeGrants: string[] = (grants[m.id] ?? []).filter((c) => !m.manifest.permissions.includes(c))
          const expanded = detail === m.id
          return (
            <div key={m.id} className="lh-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-medium">{m.manifest.name}</span>
                <span className="text-xs text-txt-dim">v{m.manifest.version}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-xs', isMeta ? 'bg-red-500/20 text-red-400' : 'bg-bg-soft text-txt-dim')}>
                  {isMeta ? '元模块' : '子模块'}
                </span>
                <span className="rounded bg-bg-soft px-1.5 py-0.5 text-xs text-txt-dim">{m.source === 'builtin' ? '内置' : '外部'}</span>
                {isMeta && m.source === 'builtin' && <span className="text-xs text-txt-dim">（meta-core 审批代理）</span>}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    className="rounded-md border border-line px-2 py-0.5 text-xs text-txt-dim hover:border-accent hover:text-accent"
                    onClick={() => setDetail(expanded ? null : m.id)}
                  >
                    {expanded ? '收起' : '权限详情'}
                  </button>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-txt-dim">
                    <input type="checkbox" className="accent-accent" checked={m.enabled} onChange={(e) => void toggleModule(m.id, e.target.checked)} />
                    启用
                  </label>
                  {m.source === 'external' && (
                    <button
                      className="rounded border border-line px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10"
                      onClick={() => {
                        if (confirm(`卸载「${m.manifest.name}」？授权记录会清除，模块私有存储会保留。`)) void removeModule(m.id)
                      }}
                    >
                      卸载
                    </button>
                  )}
                </div>
              </div>
              {m.manifest.description && <div className="mt-1 text-xs text-txt-dim">{m.manifest.description}</div>}

              {expanded && (
                <div className="mt-3 space-y-2 border-t border-line pt-3 text-xs">
                  <div className="text-txt-dim">必需权限（安装时已同意）：</div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.manifest.permissions.map((c) => (
                      <span key={c} className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent" title={isCapability(c) ? CATALOG[c as Capability].desc : ''}>
                        {c}
                      </span>
                    ))}
                    {m.manifest.permissions.length === 0 && <span className="text-txt-dim">无</span>}
                  </div>
                  <div className="text-txt-dim">运行时授予的额外权限（可撤销，撤销后立即失效）：</div>
                  <div className="flex flex-wrap gap-1.5">
                    {runtimeGrants.map((c) => (
                      <span key={c} className="flex items-center gap-1 rounded-md border border-orange-500/50 bg-orange-500/10 px-2 py-0.5 text-orange-400">
                        {c}
                        <button className="rounded-md border border-line px-1.5 py-0.5 text-txt-dim hover:border-red-400 hover:text-red-400" onClick={() => void revoke(m.id, c as Capability)} title="撤销">
                          ×
                        </button>
                      </span>
                    ))}
                    {runtimeGrants.length === 0 && <span className="text-txt-dim">无</span>}
                  </div>
                  {(m.manifest.optionalPermissions ?? []).length > 0 && (
                    <>
                      <div className="text-txt-dim">清单声明的可选权限（未授予，运行时申请时需你确认）：</div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.manifest.optionalPermissions!.filter((c) => !runtimeGrants.includes(c)).map((c) => (
                          <span key={c} className="rounded-md border border-dashed border-line px-2 py-0.5 text-txt-dim">
                            {c}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 shrink-0 text-xs text-txt-dim">
        想开发自己的模块？参阅 <code className="text-accent">docs/MODULE_DEV_GUIDE.md</code> 与示例 <code className="text-accent">modules/example-hello</code>。
      </div>
    </div>
  )
}
