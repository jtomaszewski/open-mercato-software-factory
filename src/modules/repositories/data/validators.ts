import { z } from 'zod'

const installationIdSchema = z.string().regex(/^\d{1,32}$/)
const githubRepositoryIdSchema = z.string().regex(/^\d{1,32}$/)
const branchSchema = z.string().trim().min(1).max(255)

export const repositoryListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const connectionStartSchema = z.object({
  installationId: installationIdSchema.optional(),
}).strict()

export const connectionCompleteSchema = z.object({
  installationId: installationIdSchema.optional(),
  setupAction: z.enum(['install', 'update', 'request']).optional(),
  code: z.string().min(1).max(2000).optional(),
  state: z.string().min(32).max(500),
}).strict()

export const repositoryRegisterSchema = z.object({
  connectionId: z.string().uuid(),
  githubRepositoryId: githubRepositoryIdSchema,
  baseBranch: branchSchema,
}).strict()

export const repositoryUpdateSchema = z.object({
  baseBranch: branchSchema,
  updatedAt: z.string().datetime(),
}).strict()

export const versionedActionSchema = z.object({ updatedAt: z.string().datetime() }).strict()

export const projectLinkSchema = z.object({
  projectId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  isDefault: z.boolean().default(false),
  updatedAt: z.string().datetime().optional(),
}).strict()

export const projectLinkRemoveSchema = z.object({
  projectId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  updatedAt: z.string().datetime(),
}).strict()

export const grantedRepositorySchema = z.object({
  id: githubRepositoryIdSchema,
  fullName: z.string().min(1).max(200),
  defaultBranch: z.string().min(1).max(255),
}).strict()

export const installationGrantSchema = z.object({
  installationId: installationIdSchema,
  accountLogin: z.string().min(1).max(100),
  repositories: z.array(grantedRepositorySchema).max(10000),
}).strict()

export type RepositoryRegisterInput = z.infer<typeof repositoryRegisterSchema>
export type RepositoryUpdateInput = z.infer<typeof repositoryUpdateSchema>
export type ProjectLinkInput = z.infer<typeof projectLinkSchema>
export type ProjectLinkRemoveInput = z.infer<typeof projectLinkRemoveSchema>
export type GrantedRepository = z.infer<typeof grantedRepositorySchema>
export type InstallationGrant = z.infer<typeof installationGrantSchema>
