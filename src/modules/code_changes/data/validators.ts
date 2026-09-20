import { z } from 'zod'

/** The change requests list query: one page, optionally narrowed to a status or a title. */
export const changeRequestListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['generating', 'open', 'approved', 'rejected', 'failed']).optional(),
  search: z.string().trim().min(1).max(200).optional(),
})

/** Rejecting takes a reason, because "no" without one is not an answer anybody can act on. */
export const changeRequestRejectSchema = z.object({
  reason: z.string().trim().min(1).max(8000),
})

export type ChangeRequestListQuery = z.infer<typeof changeRequestListSchema>
