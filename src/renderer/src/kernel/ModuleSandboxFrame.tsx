import { useEffect, useMemo, useRef } from 'react'
import { useRegistry } from './registry'
import { buildSandboxDoc, attachSandboxHandlers } from './sandbox'
import { useUi } from '@/stores/ui'

/** 外部模块沙箱面板：iframe + RPC 桥 */
export function ModuleSandboxFrame({ moduleId }: { moduleId: string }) {
  const mod = useRegistry((s) => s.modules[moduleId])
  const ref = useRef<HTMLIFrameElement>(null)

  const doc = useMemo(() => (mod?.enabled ? buildSandboxDoc(mod) : null), [mod])

  useEffect(() => {
    if (!ref.current || !mod || !doc) return
    return attachSandboxHandlers(ref.current, mod, (e) => useUi.getState().toast(e, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod?.id, mod?.enabled, doc])

  if (!mod || !doc) {
    return <div className="p-4 text-sm text-txt-dim">模块无法加载（缺少文件或未启用）</div>
  }
  return (
    <iframe
      ref={ref}
      srcDoc={doc}
      sandbox="allow-scripts allow-forms"
      className="h-full w-full border-0 bg-transparent"
      title={mod.manifest.name}
    />
  )
}
