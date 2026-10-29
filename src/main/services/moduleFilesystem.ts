import * as fs from 'node:fs'
import * as path from 'node:path'

interface ModuleFsOperations {
  existsSync: (path: string) => boolean
  renameSync: (from: string, to: string) => void
  rmSync: (path: string, options: { recursive: true }) => void
  now: () => number
}

/**
 * Uninstall by atomically moving the active module out of the registry directory first.
 * A cleanup failure leaves a hidden, inactive quarantine copy rather than a half-deleted live module.
 */
export function uninstallModuleDirectory(root: string, id: string, isValidId: (id: string) => boolean, operations?: Partial<ModuleFsOperations>): void {
  if (!isValidId(id)) throw new Error('不能卸载非法模块或 core.* 内置模块')
  const ops: ModuleFsOperations = {
    existsSync: operations?.existsSync ?? fs.existsSync,
    renameSync: operations?.renameSync ?? fs.renameSync,
    rmSync: operations?.rmSync ?? fs.rmSync,
    now: operations?.now ?? Date.now
  }
  const target = path.join(root, id)
  if (!ops.existsSync(target)) return
  const quarantine = path.join(root, `.uninstall-${id}-${ops.now()}`)
  ops.renameSync(target, quarantine)
  try {
    ops.rmSync(quarantine, { recursive: true })
  } catch {
    // modules:list ignores dot-prefixed folders. Keep this inactive backup for manual recovery.
  }
}
