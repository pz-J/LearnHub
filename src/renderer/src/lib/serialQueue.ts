const queues = new Map<string, Promise<unknown>>()

/** Run writes for one key in order while allowing unrelated keys to proceed independently. */
export function serializeByKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key)
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(operation)
  let tracked: Promise<T>
  tracked = next.finally(() => {
    if (queues.get(key) === tracked) queues.delete(key)
  })
  queues.set(key, tracked)
  return tracked
}
