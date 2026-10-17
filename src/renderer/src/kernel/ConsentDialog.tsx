import { CATALOG, LEVEL_LABEL, isCapability } from './permissions'
import { useUi } from '@/stores/ui'

/** 运行时授权对话框：模块申请可选能力时的用户二次确认 */
export function ConsentDialog() {
  const queue = useUi((s) => s.consentQueue)
  const resolve = useUi((s) => s.resolveConsent)
  const current = queue[0]
  if (!current || current.kind !== 'runtime') return null

  const cap = isCapability(current.capability) ? CATALOG[current.capability] : null
  const level = cap?.level ?? 'normal'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-[460px] rounded-xl border border-line bg-bg-card p-5 shadow-2xl">
        <div className="mb-1 text-sm text-txt-dim">权限申请 · 来自元模块审批通道</div>
        <h2 className="mb-3 text-lg font-semibold">
          「{current.moduleName}」请求新权限
        </h2>
        <div className="mb-3 rounded-lg border border-line bg-bg-soft p-3 text-sm">
          <div className="mb-1 flex items-center gap-2">
            <code className="rounded bg-bg px-1.5 py-0.5 text-accent">{current.capability}</code>
            <span
              className={
                level === 'danger'
                  ? 'rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400'
                  : level === 'sensitive'
                    ? 'rounded bg-orange-500/20 px-1.5 py-0.5 text-xs text-orange-400'
                    : 'rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent'
              }
            >
              {isCapability(current.capability) ? LEVEL_LABEL[level] : '普通'}权限
            </span>
          </div>
          <div className="text-txt-dim">{cap?.desc ?? '自定义能力'}</div>
        </div>
        <div className="mb-4 text-sm">
          <span className="text-txt-dim">申请理由：</span>
          {current.reason}
        </div>
        <div className="mb-4 rounded-lg bg-bg-soft p-3 text-xs text-txt-dim">
          同意后该权限将授予模块并立即生效，可随时在「模块中心」撤销。拒绝后模块将收到权限错误。
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-bg-hover"
            onClick={() => resolve(current.key, false)}
          >
            拒绝
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            onClick={() => resolve(current.key, true)}
          >
            同意授权
          </button>
        </div>
      </div>
    </div>
  )
}
