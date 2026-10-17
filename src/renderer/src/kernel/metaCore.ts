import { useUi } from '@/stores/ui'
import type { Capability } from './permissions'
import { CATALOG, isCapability } from './permissions'
import type { ModuleManifest } from './manifest'
import { useGrants } from './grants'

let keySeq = 1

export interface EscalateResult {
  granted: boolean
  reason?: string
}

/**
 * 元模块核心审批逻辑：
 * 1. 校验目标模块清单是否声明了该能力（必需 / 可选 / 元模块专属）
 * 2. 弹出授权对话框，用户二次确认
 * 3. 同意则写入 grants 并生效
 */
export async function metaEscalate(
  target: { id: string; manifest: ModuleManifest },
  capability: string,
  reason: string,
  requestedBy = 'meta-core',
  signal?: AbortSignal
): Promise<EscalateResult> {
  if (signal?.aborted) return { granted: false, reason: '请求已取消' }
  if (!isCapability(capability)) return { granted: false, reason: `未知能力: ${capability}` }
  const info = CATALOG[capability]
  if (info.metaOnly && target.manifest.type !== 'meta') {
    return { granted: false, reason: '该能力仅元模块可申请' }
  }
  const declared =
    target.manifest.permissions.includes(capability) ||
    (target.manifest.optionalPermissions ?? []).includes(capability)
  if (!declared) {
    return { granted: false, reason: `模块清单未声明能力 ${capability}（需在 optionalPermissions 中声明）` }
  }
  // 已拥有必需权限则直接放行
  if (target.manifest.permissions.includes(capability)) return { granted: true, reason: '清单必需权限' }

  // 运行时授权对话框（用户二次同意）
  const granted = await new Promise<boolean>((resolve) => {
    const key = `consent-${keySeq++}`
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      resolve(value)
    }
    const abort = () => useUi.getState().resolveConsent(key, false)
    useUi.getState().pushConsent({
      key,
      moduleId: target.id,
      moduleName: target.manifest.name,
      capability,
      reason: reason || '(未提供理由)',
      kind: 'runtime',
      requestedBy,
      resolve: finish
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
  if (signal?.aborted) return { granted: false, reason: '请求已取消' }
  // Approval must become an effective grant immediately and survive restarts.
  // Otherwise dispatchApi.requirePerm() rejects the very API the user approved.
  if (granted) await useGrants.getState().grant(target.id, capability as Capability)
  return { granted, reason: granted ? '用户已同意' : '用户已拒绝' }
}
