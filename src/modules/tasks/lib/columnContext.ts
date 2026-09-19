import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const createdColumns = new WeakMap<CommandRuntimeContext, Map<string, string>>()
const internalTransitions = new WeakMap<CommandRuntimeContext, Map<string, string>>()

export function rememberCreatedTaskColumn(ctx: CommandRuntimeContext, id: string, slug: string): void {
  const columns = createdColumns.get(ctx) ?? new Map<string, string>()
  columns.set(id, slug)
  createdColumns.set(ctx, columns)
}

export function createdTaskColumnSlug(ctx: CommandRuntimeContext, id: string): string | null {
  return createdColumns.get(ctx)?.get(id) ?? null
}

export function authorizeInternalTaskTransition(ctx: CommandRuntimeContext, taskId: string, slug: string): void {
  const transitions = internalTransitions.get(ctx) ?? new Map<string, string>()
  transitions.set(taskId, slug)
  internalTransitions.set(ctx, transitions)
}

export function consumeInternalTaskTransition(ctx: CommandRuntimeContext, taskId: string, slug: string): boolean {
  const transitions = internalTransitions.get(ctx)
  if (transitions?.get(taskId) !== slug) return false
  transitions.delete(taskId)
  return true
}
