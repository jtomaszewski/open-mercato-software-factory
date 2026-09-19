const pendingCompletions = new Map<string, Promise<unknown>>()

export function completeConnectionOnce<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const pending = pendingCompletions.get(key)
  if (pending) return pending as Promise<T>
  const started = operation()
  pendingCompletions.set(key, started)
  return started
}
