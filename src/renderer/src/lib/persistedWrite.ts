/** Publish a new in-memory snapshot only after durable storage confirms the write. */
export async function persistThenPublish<T>(value: T, persist: (value: T) => Promise<void>, publish: (value: T) => void): Promise<void> {
  await persist(value)
  publish(value)
}
