export interface ModuleTaskIdentity {
  moduleId: string
  taskId: string
  claimed: boolean
}

/** Register one module task exactly once, and publish it only after persistence succeeds. */
export function registerModuleTaskOnce<
  TTask extends ModuleTaskIdentity,
  TState extends { moduleTasks: TTask[] },
  TPersist
>(args: {
  moduleId: string
  taskId: string
  getState: () => TState
  createTask: () => TTask
  buildNext: (state: TState, moduleTasks: TTask[]) => TPersist
  persist: (next: TPersist) => Promise<void>
  publish: (next: TPersist) => void
  serialize: <T>(operation: () => Promise<T>) => Promise<T>
  maxRecords?: number
}): Promise<boolean> {
  return args.serialize(async () => {
    const state = args.getState()
    if (state.moduleTasks.some((task) => task.moduleId === args.moduleId && task.taskId === args.taskId && !task.claimed)) return false
    const nextTasks = [...state.moduleTasks, args.createTask()]
    const limit = args.maxRecords ?? 100
    while (nextTasks.length > limit) {
      const idx = nextTasks.findIndex((task) => task.claimed)
      if (idx < 0) break
      nextTasks.splice(idx, 1)
    }
    const next = args.buildNext(state, nextTasks)
    await args.persist(next)
    args.publish(next)
    return true
  })
}
