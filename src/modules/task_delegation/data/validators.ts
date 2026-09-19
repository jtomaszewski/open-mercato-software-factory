import { z } from 'zod'

const uuid = z.string().uuid()
export const delegateSchema = z.object({ taskId: uuid, agentUserId: uuid, repositoryId: uuid.optional() })
export const undelegateSchema = z.object({ taskId: uuid })
/**
 * One assignment: a person, a person and an agent, or an agent alone. An omitted key leaves that
 * half alone, which is what keeps "Remove delegate" the only way out of a live run; `null` clears
 * the human assignee. Sending neither key is not an assignment.
 */
export const assignInputSchema = z.object({
  taskId: uuid,
  assigneeStaffMemberId: uuid.nullable().optional(),
  agentUserId: uuid.nullable().optional(),
  repositoryId: uuid.optional(),
})
export const assignSchema = assignInputSchema.refine(
  (value) => value.assigneeStaffMemberId !== undefined || value.agentUserId !== undefined,
  { message: 'An assignee or an agent is required.', path: ['assigneeStaffMemberId'] },
)
export const delegationQuerySchema = z.object({
  taskIds: z.string().transform((value, ctx) => {
    const ids = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
    if (ids.length > 100 || ids.some((id) => !uuid.safeParse(id).success)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid task ids.' })
      return z.NEVER
    }
    return ids
  }),
})

export type DelegateTaskInput = z.infer<typeof delegateSchema>
export type UndelegateTaskInput = z.infer<typeof undelegateSchema>
export type AssignTaskInput = z.infer<typeof assignSchema>
