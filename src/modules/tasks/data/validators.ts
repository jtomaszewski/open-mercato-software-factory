import { z } from 'zod'

const uuid = z.string().uuid()
export const delegateSchema = z.object({ taskId: uuid, agentUserId: uuid })
export const undelegateSchema = z.object({ taskId: uuid })
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
