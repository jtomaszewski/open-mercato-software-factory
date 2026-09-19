/**
 * `createAiApiOperationRunner` with the tool's organization pinned as the selected one.
 *
 * The installed runner's synthetic request carries no `om_selected_org` cookie. For a super
 * admin, the CRUD factory reads "no selection" as "all organizations", nulls `auth.orgId`, and
 * the staff project/task routes then resolve no project access — every list comes back empty
 * (`project_not_found` for `DEMO` from the in-app chat). Setting the selection cookies to the
 * trusted tool context's tenant/org keeps the request on exactly the scope the tool runs in.
 */
import {
  createAiApiOperationRunner,
  type AiApiOperationRunner,
  type AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { getApiRouteManifests, type ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'

// `default`/`handler` are the runner's fallback for legacy route entries.
const HANDLER_KEYS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'default', 'handler'] as const

type RouteHandler = (req: Request, ctx?: unknown) => unknown

export function selectionCookie(context: Pick<AiToolExecutionContext, 'tenantId' | 'organizationId'>): string | null {
  if (!context.tenantId || !context.organizationId) return null
  return `om_selected_tenant=${encodeURIComponent(context.tenantId)}; om_selected_org=${encodeURIComponent(context.organizationId)}`
}

export function withSelectionCookie(routes: ApiRouteManifestEntry[], cookie: string): ApiRouteManifestEntry[] {
  return routes.map((route) => ({
    ...route,
    load: async () => {
      const mod = await route.load()
      const wrapped: Record<string, unknown> = { ...mod }
      for (const key of HANDLER_KEYS) {
        const handler = mod[key]
        if (typeof handler !== 'function') continue
        wrapped[key] = (req: Request, ctx?: unknown) => {
          req.headers.set('cookie', cookie)
          return (handler as RouteHandler)(req, ctx)
        }
      }
      return wrapped
    },
  }))
}

export function createScopedApiOperationRunner(context: AiToolExecutionContext): AiApiOperationRunner {
  const cookie = selectionCookie(context)
  if (!cookie) return createAiApiOperationRunner(context)
  return createAiApiOperationRunner(context, {
    loadApiRoutes: async () => withSelectionCookie(getApiRouteManifests(), cookie),
  })
}
