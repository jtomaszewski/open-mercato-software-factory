import { z } from 'zod'

const nonBlankCommand = z.string().trim().min(1).max(2000)
const boundedIdentifier = z.string().trim().min(1).max(200)
const relativeOutputDirectory = z.string().trim().min(1).max(500).refine((value) => {
  if (value.startsWith('/') || value.startsWith('\\')) return false
  return !value.split(/[\\/]+/).some((segment) => segment === '..')
}, 'repositories.validation.outputDirectory')

const commandsSchema = z.object({
  install: nonBlankCommand,
  build: nonBlankCommand,
  test: nonBlankCommand,
  typecheck: nonBlankCommand.optional(),
  lint: nonBlankCommand.optional(),
}).strict()

export const prOnlyProfileSchema = z.object({
  version: z.literal(1),
  commands: commandsSchema,
}).strict()

export const staticSiteProfileSchema = prOnlyProfileSchema.extend({
  outputDirectory: relativeOutputDirectory,
  vercel: z.object({
    accountId: boundedIdentifier,
    projectId: boundedIdentifier,
  }).strict(),
}).strict()

export const repositoryKindSchema = z.enum(['pr_only', 'static_site'])

export function parseRepositoryProfile(kind: z.infer<typeof repositoryKindSchema>, value: unknown): Record<string, unknown> {
  return (kind === 'static_site' ? staticSiteProfileSchema : prOnlyProfileSchema).parse(value)
}

export const repositoryListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  kind: repositoryKindSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const installationIdSchema = z.string().regex(/^\d{1,32}$/)

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
  githubRepositoryId: z.string().regex(/^\d{1,32}$/),
  kind: repositoryKindSchema,
  baseBranch: z.string().trim().min(1).max(255),
  profile: z.unknown(),
}).strict().transform((value, ctx) => {
  try {
    return { ...value, profile: parseRepositoryProfile(value.kind, value.profile) }
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) ctx.addIssue({ ...issue, path: ['profile', ...issue.path] })
      return z.NEVER
    }
    throw error
  }
})

export const repositoryUpdateSchema = z.object({
  baseBranch: z.string().trim().min(1).max(255),
  kind: repositoryKindSchema,
  profile: z.unknown(),
  updatedAt: z.string().datetime(),
}).strict().transform((value, ctx) => {
  try {
    return { ...value, profile: parseRepositoryProfile(value.kind, value.profile) }
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) ctx.addIssue({ ...issue, path: ['profile', ...issue.path] })
      return z.NEVER
    }
    throw error
  }
})

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

export const usabilityQuerySchema = z.object({
  delegationId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  epoch: z.coerce.number().int().min(1),
  profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  installationId: installationIdSchema,
  authorizationId: z.string().uuid(),
  githubRepositoryId: z.string().regex(/^\d{1,32}$/),
  baseBranch: z.string().trim().min(1).max(255),
}).strict()

export const grantedRepositorySchema = z.object({
  id: z.string().regex(/^\d{1,32}$/),
  fullName: z.string().min(1).max(200),
  defaultBranch: z.string().min(1).max(255),
}).strict()

export const installationGrantSchema = z.object({
  installationId: installationIdSchema,
  accountLogin: z.string().min(1).max(100),
  repositories: z.array(grantedRepositorySchema).max(10000),
}).strict()

export const brokerInstallationGrantSchema = installationGrantSchema.extend({
  authorizationId: z.string().uuid(),
}).strict()

export const qualificationReportSchema = z.object({
  checks: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    status: z.enum(['passed', 'failed']),
    message: z.string().max(2000),
  }).strict()).max(100),
}).strict()

export const qualificationCallbackSchema = z.object({
  installationId: z.string().regex(/^\d{1,32}$/),
  repositoryId: z.string().uuid(),
  epoch: z.number().int().min(1),
  attemptId: z.string().uuid(),
  status: z.enum(['passed', 'failed']),
  report: qualificationReportSchema,
}).strict()

export const installationEventSchema = z.object({
  installationId: z.string().regex(/^\d{1,32}$/),
  event: z.enum(['suspended', 'removed', 'grants_changed', 'restored']),
  repositoryIds: z.array(z.string().regex(/^\d{1,32}$/)).max(10000).optional(),
}).strict()

export type RepositoryRegisterInput = z.infer<typeof repositoryRegisterSchema>
export type RepositoryUpdateInput = z.infer<typeof repositoryUpdateSchema>
export type QualificationCallbackInput = z.infer<typeof qualificationCallbackSchema>
export type ProjectLinkInput = z.infer<typeof projectLinkSchema>
export type ProjectLinkRemoveInput = z.infer<typeof projectLinkRemoveSchema>
