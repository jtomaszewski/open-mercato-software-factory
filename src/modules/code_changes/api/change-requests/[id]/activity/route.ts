import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTaskRoute } from '../../../../../task_delegation/api/route-context'
import { readChangeRequestActivity } from '../../../../lib/activity'
import { codeChangesErrorSchema, codeChangesTag } from '../../../openapi'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = { GET: { requireAuth: true, requireFeatures: ['code_changes.view'] } }

/**
 * What is happening to this change right now — polled by the detail page while the run is live.
 *
 * Separate from the change request endpoint on purpose: this one is read every few seconds, so it
 * stays narrow, and its optional orchestrator reads can degrade to "nothing known" without ever
 * affecting the record the page is really about.
 */
export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  return withTaskRoute(request, ['code_changes.view'], async ({ commandContext }) => {
    const { id } = paramsSchema.parse(await route.params)
    return Response.json({ activity: await readChangeRequestActivity(commandContext, id) })
  })
}

const stepSchema = z.object({
  id: z.string(),
  kind: z.enum(['reading', 'editing', 'building', 'researching', 'reporting', 'thinking']),
  tool: z.string(),
  detail: z.string().nullable(),
  status: z.enum(['ok', 'error']),
  at: z.string(),
  durationMs: z.number().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: codeChangesTag, summary: 'Live activity of a change request', methods: {
    GET: {
      summary: 'The stage the run is at and what its agents did, for live progress on the detail page',
      responses: [{
        status: 200,
        description: 'Activity of the run behind this change request; empty when it has none',
        schema: z.object({
          activity: z.object({
            active: z.boolean(),
            stage: z.string().nullable(),
            lastActivityAt: z.string().nullable(),
            runs: z.array(z.object({
              id: z.string().uuid(),
              agentId: z.string(),
              status: z.enum(['running', 'ok', 'error', 'cancelled']),
              startedAt: z.string(),
              completedAt: z.string().nullable(),
              errorMessage: z.string().nullable(),
              steps: z.array(stepSchema),
            })),
          }),
        }),
      }],
      errors: [
        { status: 403, description: 'Missing scope or feature', schema: codeChangesErrorSchema },
        { status: 404, description: 'Not found or not accessible', schema: codeChangesErrorSchema },
      ],
    },
  },
}
