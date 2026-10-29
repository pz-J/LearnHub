/** Only report a quick-created task as complete after its store confirms persistence. */
export async function createTodoWithFeedback<T>(args: {
  title: string
  add: (title: string) => Promise<T>
  onSuccess: (created: T) => void
  onError: (error: unknown) => void
}): Promise<boolean> {
  const title = args.title.trim()
  if (!title) return false
  let created: T
  try {
    created = await args.add(title)
  } catch (error) {
    args.onError(error)
    return false
  }
  args.onSuccess(created)
  return true
}
