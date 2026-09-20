import { createHash, randomBytes } from 'node:crypto'
import { LockMode, type EntityManager, type FilterQuery } from '@mikro-orm/postgresql'
import { extractUndoPayload, registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { TimeTrackingAccessResolver } from '@open-mercato/core/modules/staff/di'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { readTimeTrackingSettings } from '@open-mercato/core/modules/staff/lib/time-tracking/settings'
import { CodeRepository, RepositoryConnection, RepositoryConnectState, RepositoryProjectLink } from '../data/entities'
import type { GrantedRepository, ProjectLinkInput, ProjectLinkRemoveInput, RepositoryRegisterInput, RepositoryUpdateInput } from '../data/validators'
import { requireRepositoryScope, type RepositoryScope } from '../lib/auth'
import { GitHubAppError, REPOSITORY_GITHUB_APP, type GitHubApp } from '../lib/github-app'
import { ConnectionConsentError, resolveConnectionConsent, type ConnectionConsentInput } from '../lib/connection-consent'

const CONNECT_STATE_TTL_MS = 10 * 60 * 1000

type StartConnectionInput = { installationId?: string }
type StartConnectionResult = { redirectUrl: string }
type CompleteConnectionInput = ConnectionConsentInput & { state: string }
type CompleteConnectionResult =
  | { status: 'waiting' }
  | { status: 'connected'; connectionId: string; grantedRepositories: GrantedRepository[] }
type RepositoryResult = { id: string; updatedAt: string }
type VersionedRepositoryInput = { id: string; updatedAt: string }
type RepositoryStatusSnapshot = { id: string; status: 'active' | 'disabled'; updatedAt: string }
type RepositoryStatusUndoPayload = { before: RepositoryStatusSnapshot; changedUpdatedAt: string }
type ProjectLinkSnapshot = { id: string; projectId: string; repositoryId: string; isDefault: boolean; createdBy: string; createdAt: string; updatedAt: string }
type ProjectLinkUndoState = {
  beforeLink: ProjectLinkSnapshot | null
  beforeDefault: ProjectLinkSnapshot | null
  changedDefaultUpdatedAt: string | null
}
type ProjectLinkResult = { id: string; projectId: string; repositoryId: string; isDefault: boolean; updatedAt: string; undoState?: ProjectLinkUndoState }

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function emFrom(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em').fork()
}

function gitHubAppFrom(ctx: CommandRuntimeContext): GitHubApp {
  return ctx.container.resolve<GitHubApp>(REPOSITORY_GITHUB_APP)
}

/**
 * Where GitHub should send the consent back to: the origin this request arrived on, else the
 * configured `APP_URL`. Each Conductor worktree serves on its own port, so the App carries
 * several callback URLs and the right one is whichever origin the operator is actually using.
 */
function consentRedirectUri(ctx: CommandRuntimeContext): string | null {
  const requestUrl = ctx.request?.url
  const origin = (() => {
    if (requestUrl) {
      try { return new URL(requestUrl).origin } catch { /* fall through to APP_URL */ }
    }
    const configured = process.env.APP_URL?.trim()
    if (!configured) return null
    try { return new URL(configured).origin } catch { return null }
  })()
  return origin ? `${origin}/backend/repositories/connect` : null
}

function repositoryError(status: number, code: string): CrudHttpError {
  return new CrudHttpError(status, { code, error: `repositories.errors.${code}` })
}

function scopeLog(ctx: CommandRuntimeContext) {
  return { tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId }
}

async function scopedRepository(em: EntityManager, scope: RepositoryScope, id: string, lock = false): Promise<CodeRepository> {
  const repository = await em.findOne(
    CodeRepository,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {},
  )
  if (!repository) throw repositoryError(404, 'notFound')
  return repository
}

async function activeConnection(em: EntityManager, scope: RepositoryScope, id: string): Promise<RepositoryConnection> {
  const connection = await em.findOne(RepositoryConnection, { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
  if (!connection) throw repositoryError(404, 'connectionNotFound')
  if (connection.status !== 'active') throw repositoryError(409, 'connectionUnavailable')
  return connection
}

function ensureCurrentVersion(ctx: CommandRuntimeContext, repository: CodeRepository, updatedAt: string): void {
  const headers = new Headers(ctx.request?.headers)
  headers.set('x-om-ext-optimistic-lock-expected-updated-at', updatedAt)
  const request = new Request(ctx.request?.url ?? 'http://repositories.internal/', { method: ctx.request?.method ?? 'POST', headers })
  enforceCommandOptimisticLock({ resourceKind: 'repositories.repository', resourceId: repository.id, current: repository.updatedAt, request })
}

function ensureLinkVersion(link: RepositoryProjectLink, updatedAt?: string): void {
  if (!updatedAt || link.updatedAt.toISOString() !== updatedAt) throw repositoryError(409, 'projectLinkChanged')
}

function projectLinkSnapshot(link: RepositoryProjectLink): ProjectLinkSnapshot {
  return {
    id: link.id,
    projectId: link.projectId,
    repositoryId: link.repositoryId,
    isDefault: link.isDefault,
    createdBy: link.createdBy,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  }
}

async function requireProjectAccess(ctx: CommandRuntimeContext, em: EntityManager, scope: RepositoryScope, projectId: string): Promise<void> {
  const projects = await ctx.container.resolve<QueryEngine>('queryEngine').query<{ id: string }>('staff:staff_time_project', {
    fields: ['id'], filters: { id: projectId }, page: { page: 1, pageSize: 1 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  if (!projects.items[0]) throw repositoryError(404, 'projectNotFound')
  const canManageAll = await ctx.container.resolve<{ userHasAllFeatures(userId: string, features: string[], scope: { tenantId: string; organizationId: string }): Promise<boolean> }>('rbacService')
    .userHasAllFeatures(scope.userId, ['staff.timesheets.projects.manage'], scope)
  const settings = await readTimeTrackingSettings(ctx.container.resolve<ModuleConfigService>('moduleConfigService'), { tenantId: scope.tenantId })
  const access = await ctx.container.resolve<TimeTrackingAccessResolver>('timeTrackingAccessResolver').resolveProjectAccess({
    em,
    ...scope,
    canManageAll,
    assignmentGraceDays: settings.access.assignmentGraceDays,
  })
  if (!access.canManageAll && !access.projectIds.includes(projectId)) throw repositoryError(403, 'projectForbidden')
}

/** The repository must be in the connection's consented grant and the branch must exist on GitHub. */
async function confirmGrantedRepository(
  app: GitHubApp,
  connection: RepositoryConnection,
  githubRepositoryId: string,
  baseBranch: string,
): Promise<GrantedRepository> {
  const grant = await app.getInstallationGrant(connection.installationId, connection.authorizedRepositoryIds)
  const repository = grant.repositories.find((item) => item.id === githubRepositoryId)
  if (!repository) throw repositoryError(422, 'repositoryNotGranted')
  const branches = await app.listBranches(connection.installationId, githubRepositoryId)
  if (!branches.includes(baseBranch)) throw repositoryError(422, 'branchNotGranted')
  return repository
}

const startConnectionCommand: CommandHandler<StartConnectionInput, StartConnectionResult> = {
  id: 'repositories.connection.start',
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const app = gitHubAppFrom(ctx)
    if (!app.isConfigured()) throw new GitHubAppError('not_configured')
    const rawState = randomBytes(32).toString('base64url')
    const em = emFrom(ctx)
    await em.nativeDelete(RepositoryConnectState, { expiresAt: { $lt: new Date() } } as FilterQuery<RepositoryConnectState>)
    em.persist(em.create(RepositoryConnectState, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      nonceHash: sha256Hex(rawState),
      expectedInstallationId: input.installationId ?? null,
      expiresAt: new Date(Date.now() + CONNECT_STATE_TTL_MS),
    }))
    await em.flush()
    return {
      redirectUrl: input.installationId
        ? app.buildAuthorizeUrl(rawState, consentRedirectUri(ctx))
        : app.buildInstallUrl(rawState),
    }
  },
  buildLog({ ctx }) {
    return { actionLabel: 'repositories.audit.connection.start', resourceKind: 'repositories.connection', ...scopeLog(ctx) }
  },
}

/**
 * The GitHub return: the single-use state must belong to this user, and the OAuth code proves the
 * user can see the installation. Only repositories that user can push to are ever reachable.
 */
const completeConnectionCommand: CommandHandler<CompleteConnectionInput, CompleteConnectionResult> = {
  id: 'repositories.connection.complete',
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const em = emFrom(ctx)
    const stateWhere = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      nonceHash: sha256Hex(input.state),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }
    const state = await em.findOne(RepositoryConnectState, stateWhere as FilterQuery<RepositoryConnectState>)
    if (!state) throw repositoryError(400, 'connectionStateExpired')
    let consent
    try {
      consent = resolveConnectionConsent(input, state.expectedInstallationId ?? null)
    } catch (error) {
      if (error instanceof ConnectionConsentError) throw repositoryError(400, error.code)
      throw error
    }
    if (consent.kind === 'waiting') return { status: 'waiting' }
    // The same redirect_uri the authorize step sent, or GitHub refuses the exchange. The callback
    // arrives on the origin that started the consent, so deriving it again here agrees.
    const grant = await gitHubAppFrom(ctx).verifyInstallationConsent(consent.installationId, consent.code, consentRedirectUri(ctx))
    const connection = await em.transactional(async (tx) => {
      const locked = await tx.findOne(RepositoryConnectState, { ...stateWhere, id: state.id } as FilterQuery<RepositoryConnectState>, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!locked) throw repositoryError(400, 'connectionStateExpired')
      const existing = await tx.findOne(RepositoryConnection, { provider: 'github', installationId: grant.installationId, deletedAt: null })
      if (existing && (existing.tenantId !== scope.tenantId || existing.organizationId !== scope.organizationId)) {
        throw repositoryError(409, 'installationBound')
      }
      locked.usedAt = new Date()
      const next = existing ?? tx.create(RepositoryConnection, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        installationId: grant.installationId,
        authorizedRepositoryIds: grant.authorizedRepositoryIds,
        accountLogin: grant.accountLogin,
        connectedBy: scope.userId,
      })
      next.accountLogin = grant.accountLogin
      next.authorizedRepositoryIds = grant.authorizedRepositoryIds
      next.status = 'active'
      tx.persist([locked, next])
      await tx.flush()
      return next
    })
    return { status: 'connected', connectionId: connection.id, grantedRepositories: grant.repositories }
  },
  buildLog({ result, ctx }) {
    return {
      actionLabel: 'repositories.audit.connection.complete',
      resourceKind: 'repositories.connection',
      resourceId: result.status === 'connected' ? result.connectionId : undefined,
      ...scopeLog(ctx),
    }
  },
}

const registerRepositoryCommand: CommandHandler<RepositoryRegisterInput, RepositoryResult> = {
  id: 'repositories.repository.register',
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const em = emFrom(ctx)
    const connection = await activeConnection(em, scope, input.connectionId)
    const granted = await confirmGrantedRepository(gitHubAppFrom(ctx), connection, input.githubRepositoryId, input.baseBranch)
    try {
      const repository = await em.transactional(async (tx) => {
        const existing = await tx.findOne(CodeRepository, { organizationId: scope.organizationId, githubRepositoryId: granted.id, deletedAt: null })
        if (existing) throw repositoryError(409, 'alreadyRegistered')
        const created = tx.create(CodeRepository, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          connectionId: connection.id,
          githubRepositoryId: granted.id,
          fullName: granted.fullName,
          baseBranch: input.baseBranch,
        })
        tx.persist(created)
        await tx.flush()
        return created
      })
      return { id: repository.id, updatedAt: repository.updatedAt.toISOString() }
    } catch (error) {
      if (isUniqueViolation(error, 'repositories_repositories_org_github_uq')) throw repositoryError(409, 'alreadyRegistered')
      throw error
    }
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.repository.register', resourceKind: 'repositories.repository', resourceId: result.id, ...scopeLog(ctx) }
  },
}

const updateRepositoryCommand: CommandHandler<RepositoryUpdateInput & { id: string }, RepositoryResult> = {
  id: 'repositories.repository.update',
  async prepare(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const repository = await scopedRepository(emFrom(ctx), scope, input.id)
    return { before: serializeRepository(repository) }
  },
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const em = emFrom(ctx)
    const observed = await scopedRepository(em, scope, input.id)
    if (observed.baseBranch !== input.baseBranch) {
      const connection = await activeConnection(em, scope, observed.connectionId)
      await confirmGrantedRepository(gitHubAppFrom(ctx), connection, observed.githubRepositoryId, input.baseBranch)
    }
    const repository = await em.transactional(async (tx) => {
      const locked = await scopedRepository(tx, scope, input.id, true)
      ensureCurrentVersion(ctx, locked, input.updatedAt)
      locked.baseBranch = input.baseBranch
      await tx.flush()
      return locked
    })
    return { id: repository.id, updatedAt: repository.updatedAt.toISOString() }
  },
  captureAfter(_input, result) { return result },
  buildLog({ result, ctx, snapshots }) {
    return { actionLabel: 'repositories.audit.repository.update', resourceKind: 'repositories.repository', resourceId: result.id, ...scopeLog(ctx), snapshotBefore: snapshots.before, snapshotAfter: snapshots.after }
  },
}

function statusCommand(status: 'active' | 'disabled'): CommandHandler<VersionedRepositoryInput, RepositoryResult> {
  const setStatus = async (ctx: CommandRuntimeContext, id: string, updatedAt: string, next: 'active' | 'disabled') => {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    return emFrom(ctx).transactional(async (tx) => {
      const locked = await scopedRepository(tx, scope, id, true)
      ensureCurrentVersion(ctx, locked, updatedAt)
      locked.status = next
      await tx.flush()
      return locked
    })
  }
  return {
    id: `repositories.repository.${status === 'active' ? 'enable' : 'disable'}`,
    isUndoable: true,
    async prepare(input, ctx) {
      const scope = await requireRepositoryScope(ctx, 'repositories.manage')
      const repository = await scopedRepository(emFrom(ctx), scope, input.id)
      return { before: { id: repository.id, status: repository.status, updatedAt: repository.updatedAt.toISOString() } satisfies RepositoryStatusSnapshot }
    },
    async execute(input, ctx) {
      const repository = await setStatus(ctx, input.id, input.updatedAt, status)
      return { id: repository.id, updatedAt: repository.updatedAt.toISOString() }
    },
    captureAfter(_input, result) { return result },
    buildLog({ result, ctx, snapshots }) {
      return {
        actionLabel: `repositories.audit.repository.${status}`,
        resourceKind: 'repositories.repository',
        resourceId: result.id,
        ...scopeLog(ctx),
        payload: { undo: { before: snapshots.before, changedUpdatedAt: result.updatedAt } },
        snapshotBefore: snapshots.before,
        snapshotAfter: snapshots.after,
      }
    },
    async undo({ ctx, logEntry }) {
      const undo = extractUndoPayload<RepositoryStatusUndoPayload>(logEntry)
      if (!undo) return
      await setStatus(ctx, undo.before.id, undo.changedUpdatedAt, undo.before.status)
    },
  }
}

const disableRepositoryCommand = statusCommand('disabled')
const enableRepositoryCommand = statusCommand('active')

const removeRepositoryCommand: CommandHandler<VersionedRepositoryInput, RepositoryResult> = {
  id: 'repositories.repository.remove',
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const repository = await emFrom(ctx).transactional(async (tx) => {
      const locked = await scopedRepository(tx, scope, input.id, true)
      ensureCurrentVersion(ctx, locked, input.updatedAt)
      if (locked.status !== 'disabled') throw repositoryError(409, 'disableBeforeRemove')
      const links = await tx.find(RepositoryProjectLink, { tenantId: scope.tenantId, organizationId: scope.organizationId, repositoryId: locked.id })
      for (const link of links) tx.remove(link)
      locked.deletedAt = new Date()
      await tx.flush()
      return locked
    })
    return { id: repository.id, updatedAt: repository.updatedAt.toISOString() }
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.repository.remove', resourceKind: 'repositories.repository', resourceId: result.id, ...scopeLog(ctx) }
  },
}

const setProjectLinkCommand: CommandHandler<ProjectLinkInput, ProjectLinkResult> = {
  id: 'repositories.project_link.set',
  isUndoable: true,
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.link')
    const em = emFrom(ctx)
    await requireProjectAccess(ctx, em, scope, input.projectId)
    await scopedRepository(em, scope, input.repositoryId)
    try {
      const committed = await em.transactional(async (tx) => {
        const existing = await tx.findOne(RepositoryProjectLink, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: input.projectId,
          repositoryId: input.repositoryId,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (existing) ensureLinkVersion(existing, input.updatedAt)
        const beforeLink = existing ? projectLinkSnapshot(existing) : null
        let beforeDefault: ProjectLinkSnapshot | null = null
        let changedDefault: RepositoryProjectLink | null = null
        if (input.isDefault) {
          const currentDefault = await tx.findOne(RepositoryProjectLink, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            projectId: input.projectId,
            isDefault: true,
          }, { lockMode: LockMode.PESSIMISTIC_WRITE })
          if (currentDefault && currentDefault.id !== existing?.id) {
            beforeDefault = projectLinkSnapshot(currentDefault)
            currentDefault.isDefault = false
            changedDefault = currentDefault
            await tx.flush()
          }
        }
        const next = existing ?? tx.create(RepositoryProjectLink, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: input.projectId,
          repositoryId: input.repositoryId,
          createdBy: scope.userId,
        })
        next.isDefault = input.isDefault
        tx.persist(next)
        await tx.flush()
        return {
          link: next,
          undoState: {
            beforeLink,
            beforeDefault,
            changedDefaultUpdatedAt: changedDefault?.updatedAt.toISOString() ?? null,
          } satisfies ProjectLinkUndoState,
        }
      })
      const link = committed.link
      return { id: link.id, projectId: link.projectId, repositoryId: link.repositoryId, isDefault: link.isDefault, updatedAt: link.updatedAt.toISOString(), undoState: committed.undoState }
    } catch (error) {
      if (isUniqueViolation(error, 'repositories_project_links_org_project_repository_uq')
        || isUniqueViolation(error, 'repositories_project_links_org_project_default_uq')) throw repositoryError(409, 'projectLinkChanged')
      throw error
    }
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.projectLink.set', resourceKind: 'repositories.project_link', resourceId: result.id, ...scopeLog(ctx), payload: { undo: { result, state: result.undoState } }, context: result }
  },
  async undo({ ctx, logEntry }) {
    const undo = extractUndoPayload<{ result: ProjectLinkResult; state: ProjectLinkUndoState }>(logEntry)
    if (!undo?.state) return
    const scope = await requireRepositoryScope(ctx, 'repositories.link')
    const em = emFrom(ctx)
    await requireProjectAccess(ctx, em, scope, undo.result.projectId)
    await em.transactional(async (tx) => {
      const current = await tx.findOne(RepositoryProjectLink, {
        tenantId: scope.tenantId, organizationId: scope.organizationId, id: undo.result.id,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!current) throw repositoryError(409, 'projectLinkChanged')
      ensureLinkVersion(current, undo.result.updatedAt)
      if (undo.state.beforeLink) current.isDefault = undo.state.beforeLink.isDefault
      else tx.remove(current)
      await tx.flush()
      if (undo.state.beforeDefault) {
        const previousDefault = await tx.findOne(RepositoryProjectLink, {
          tenantId: scope.tenantId, organizationId: scope.organizationId, id: undo.state.beforeDefault.id,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (!previousDefault) throw repositoryError(409, 'projectLinkChanged')
        ensureLinkVersion(previousDefault, undo.state.changedDefaultUpdatedAt ?? undefined)
        previousDefault.isDefault = true
      }
      await tx.flush()
    })
  },
}

const removeProjectLinkCommand: CommandHandler<ProjectLinkRemoveInput, ProjectLinkResult> = {
  id: 'repositories.project_link.remove',
  isUndoable: true,
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.link')
    const em = emFrom(ctx)
    await requireProjectAccess(ctx, em, scope, input.projectId)
    return em.transactional(async (tx) => {
      const link = await tx.findOne(RepositoryProjectLink, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!link) throw repositoryError(404, 'projectLinkNotFound')
      ensureLinkVersion(link, input.updatedAt)
      const snapshot = projectLinkSnapshot(link)
      tx.remove(link)
      await tx.flush()
      return {
        id: snapshot.id, projectId: snapshot.projectId, repositoryId: snapshot.repositoryId, isDefault: snapshot.isDefault, updatedAt: snapshot.updatedAt,
        undoState: { beforeLink: snapshot, beforeDefault: null, changedDefaultUpdatedAt: null },
      }
    })
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.projectLink.remove', resourceKind: 'repositories.project_link', resourceId: result.id, ...scopeLog(ctx), payload: { undo: result.undoState?.beforeLink }, context: result }
  },
  async undo({ ctx, logEntry }) {
    const snapshot = extractUndoPayload<ProjectLinkSnapshot>(logEntry)
    if (!snapshot) return
    const scope = await requireRepositoryScope(ctx, 'repositories.link')
    const em = emFrom(ctx)
    await requireProjectAccess(ctx, em, scope, snapshot.projectId)
    await em.transactional(async (tx) => {
      const existing = await tx.findOne(RepositoryProjectLink, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        projectId: snapshot.projectId,
        repositoryId: snapshot.repositoryId,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (existing) throw repositoryError(409, 'projectLinkChanged')
      if (snapshot.isDefault) {
        const currentDefault = await tx.findOne(RepositoryProjectLink, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: snapshot.projectId,
          isDefault: true,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (currentDefault) throw repositoryError(409, 'projectLinkChanged')
      }
      tx.persist(tx.create(RepositoryProjectLink, {
        id: snapshot.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        projectId: snapshot.projectId,
        repositoryId: snapshot.repositoryId,
        isDefault: snapshot.isDefault,
        createdBy: snapshot.createdBy,
        createdAt: new Date(snapshot.createdAt),
        updatedAt: new Date(snapshot.updatedAt),
      }))
      await tx.flush()
    })
  },
}

function serializeRepository(repository: CodeRepository): Record<string, unknown> {
  return {
    id: repository.id,
    fullName: repository.fullName,
    baseBranch: repository.baseBranch,
    status: repository.status,
    updatedAt: repository.updatedAt.toISOString(),
  }
}

registerCommand(startConnectionCommand)
registerCommand(completeConnectionCommand)
registerCommand(registerRepositoryCommand)
registerCommand(updateRepositoryCommand)
registerCommand(disableRepositoryCommand)
registerCommand(enableRepositoryCommand)
registerCommand(removeRepositoryCommand)
registerCommand(setProjectLinkCommand)
registerCommand(removeProjectLinkCommand)

export const repositoryCommands = {
  startConnectionCommand,
  completeConnectionCommand,
  registerRepositoryCommand,
  updateRepositoryCommand,
  disableRepositoryCommand,
  enableRepositoryCommand,
  removeRepositoryCommand,
  setProjectLinkCommand,
  removeProjectLinkCommand,
}
