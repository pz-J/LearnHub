/** Serialize deletion with writes for the same note so a late autosave cannot resurrect it. */
export async function removeNoteDurably<T extends Record<string, unknown>>(args: {
  id: string
  serialize: <R>(key: string, operation: () => Promise<R>) => Promise<R>
  removeFromDisk: (id: string) => Promise<void>
  current: () => T
  publish: (notes: T) => void
  emit: () => void
}): Promise<void> {
  await args.serialize(args.id, async () => {
    await args.removeFromDisk(args.id)
    const next = { ...args.current() }
    delete next[args.id]
    args.publish(next)
    args.emit()
  })
}
