import { z } from 'zod'

/** One tag and one error shape for every code-changes route, instead of six copies of each. */
export const codeChangesTag = 'Code changes'
export const codeChangesErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
})

export const changeRequestSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  delegationId: z.string().uuid().nullable(),
  projectId: z.string().uuid(),
  projectName: z.string().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  repoFullName: z.string(),
  baseBranch: z.string(),
  branch: z.string().nullable(),
  number: z.number().int().nullable(),
  url: z.string().nullable(),
  headSha: z.string().nullable(),
  mergeCommitSha: z.string().nullable(),
  status: z.enum(['generating', 'open', 'approved', 'rejected', 'failed']),
  statusReason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const changeRequestPageSchema = z.object({
  items: z.array(changeRequestSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

export const changeRequestDecisionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['generating', 'open', 'approved', 'rejected', 'failed']),
})
