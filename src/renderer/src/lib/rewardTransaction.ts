/** Persist a claim before granting its reward; restore the previous claim if reward persistence fails. */
export async function commitRewardClaim<T>(args: {
  previous: T
  next: T
  persist: (value: T) => Promise<void>
  grant: () => Promise<void>
  publish: (value: T) => void
}): Promise<void> {
  await args.persist(args.next)
  try {
    await args.grant()
  } catch (error) {
    try {
      await args.persist(args.previous)
    } catch (rollbackError) {
      throw new Error(`奖励发放失败，且领取状态回滚失败：${(rollbackError as Error).message || '请重启后检查奖励状态'}；原始错误：${(error as Error).message || '未知错误'}`)
    }
    throw error
  }
  args.publish(args.next)
}
