import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { TasksDelegationReadItem } from '../lib/delegationService'

type Listener = { resolve: (item: TasksDelegationReadItem | null) => void; reject: (error: unknown) => void }
let pending = new Map<string, Listener[]>()
let scheduled = false

async function flush(): Promise<void> {
  const batch = pending
  pending = new Map()
  scheduled = false
  const ids = [...batch.keys()]
  await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, async (_, page) => {
    const taskIds = ids.slice(page * 100, (page + 1) * 100)
    try {
      const response = await readApiResultOrThrow<{ items: TasksDelegationReadItem[] }>(`/api/tasks/delegations?taskIds=${encodeURIComponent(taskIds.join(','))}`)
      const items = new Map(response.items.map((item) => [item.taskId, item]))
      for (const taskId of taskIds) for (const listener of batch.get(taskId)!) listener.resolve(items.get(taskId) ?? null)
    } catch (error) {
      for (const taskId of taskIds) for (const listener of batch.get(taskId)!) listener.reject(error)
    }
  }))
}

export function loadTaskDelegation(taskId: string): Promise<TasksDelegationReadItem | null> {
  return new Promise((resolve, reject) => {
    const listeners = pending.get(taskId) ?? []
    listeners.push({ resolve, reject })
    pending.set(taskId, listeners)
    if (!scheduled) {
      scheduled = true
      queueMicrotask(() => { void flush() })
    }
  })
}
