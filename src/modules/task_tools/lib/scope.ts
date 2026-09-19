import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

export type TaskToolScope = {
  tenantId: string
  organizationId: string
  userId: string
}

/**
 * Fail-closed scope for every `task_tools.*` handler.
 *
 * Tenant, organization and user come only from the runtime-supplied context (the
 * MCP API key or chat session) — no tool input carries scope, so a prompt-injected
 * model cannot address another tenant. Missing scope is a refusal, never "all".
 * The user is required because the `staff` routes stamp authorship and resolve
 * project membership from it.
 */
export function requireToolScope(
  context: Pick<McpToolContext, 'tenantId' | 'organizationId' | 'userId'>,
): TaskToolScope {
  const tenantId = typeof context.tenantId === 'string' ? context.tenantId.trim() : ''
  const organizationId = typeof context.organizationId === 'string' ? context.organizationId.trim() : ''
  const userId = typeof context.userId === 'string' ? context.userId.trim() : ''
  if (!tenantId || !organizationId) {
    throw new Error('[internal] task_tools require a tenant- and organization-scoped context')
  }
  if (!userId) {
    throw new Error('[internal] task_tools require a user context')
  }
  return { tenantId, organizationId, userId }
}
