import { z } from 'zod'

export const repositoriesTag = 'Code repositories'
export const repositoryErrorSchema = z.object({ error: z.string(), code: z.string().optional(), fieldErrors: z.record(z.string(), z.array(z.string())).optional() })
export const repositoryMutationResponseSchema = z.object({ id: z.string().uuid(), updatedAt: z.string(), attemptId: z.string().uuid().optional() })

