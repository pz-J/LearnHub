/** Preserve grants when a filesystem uninstall fails, so the still-installed module remains recoverable. */
export async function uninstallWithGrantRollback(args: {
  id: string
  previousGrants: string[]
  revokeAll: (id: string) => Promise<void>
  uninstall: (id: string) => Promise<unknown>
  grant: (id: string, capability: string) => Promise<void>
}): Promise<void> {
  await args.revokeAll(args.id)
  try {
    await args.uninstall(args.id)
  } catch (error) {
    try {
      for (const capability of args.previousGrants) await args.grant(args.id, capability)
    } catch (restoreError) {
      throw new Error(`卸载失败，且恢复原授权时也失败：${(restoreError as Error).message || '未知错误'}；原始错误：${(error as Error).message || '未知错误'}`)
    }
    throw error
  }
}

/** Keep an existing module installation and its grants coherent when an update/install step fails. */
export async function installWithGrantRollback(args: {
  prepareGrants: () => Promise<void>
  enable: () => Promise<void>
  install: () => Promise<unknown>
  restoreGrants: () => Promise<void>
  restoreEnabled: () => Promise<void>
}): Promise<void> {
  try {
    await args.prepareGrants()
    await args.enable()
    await args.install()
  } catch (error) {
    const recoveryErrors: string[] = []
    try { await args.restoreGrants() } catch (restoreError) { recoveryErrors.push(`恢复授权失败：${(restoreError as Error).message || '未知错误'}`) }
    try { await args.restoreEnabled() } catch (restoreError) { recoveryErrors.push(`恢复启用状态失败：${(restoreError as Error).message || '未知错误'}`) }
    if (recoveryErrors.length) throw new Error(`模块安装/更新失败：${(error as Error).message || '未知错误'}；${recoveryErrors.join('；')}`)
    throw error
  }
}
