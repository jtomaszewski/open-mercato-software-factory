/**
 * Hand-off between the tasks commands and the staff command guard. Staff 0.8.0 passes interceptors
 * the caller's `auth` object (the same reference as `ctx.auth`) but not the command context, so the
 * registry is keyed by that object: a request's own delegate/undelegate command can authorize the
 * column move it is about to make, and nobody else sees the authorization.
 */
type ColumnKey = object

type ColumnContextState = {
  internalTransitions: WeakMap<ColumnKey, Map<string, string>>
}

// The generator inlines this file into more than one bundle (commands and command interceptors),
// so module-level maps would be separate copies: the guard would never see what the delegate
// command authorized. Keep one registry per process instead.
const STATE_KEY = Symbol.for('open-mercato.task_delegation.column-context')
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: ColumnContextState }
const state = (globalState[STATE_KEY] ??= { internalTransitions: new WeakMap() })
const { internalTransitions } = state

export function authorizeInternalTaskTransition(key: ColumnKey | null | undefined, taskId: string, slug: string): void {
  if (!key) throw new Error('[internal] Task transition requires an authenticated command context')
  const transitions = internalTransitions.get(key) ?? new Map<string, string>()
  transitions.set(taskId, slug)
  internalTransitions.set(key, transitions)
}

export function consumeInternalTaskTransition(key: ColumnKey | null | undefined, taskId: string, slug: string): boolean {
  const transitions = key ? internalTransitions.get(key) : undefined
  if (transitions?.get(taskId) !== slug) return false
  transitions.delete(taskId)
  return true
}

export function revokeInternalTaskTransition(key: ColumnKey | null | undefined, taskId: string): void {
  if (key) internalTransitions.get(key)?.delete(taskId)
}
