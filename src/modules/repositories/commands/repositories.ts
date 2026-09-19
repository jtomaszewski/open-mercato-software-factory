import { randomBytes } from 'node:crypto'
import { LockMode, type EntityManager, type FilterQuery } from '@mikro-orm/postgresql'
import { extractUndoPayload, registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { TimeTrackingAccessResolver } from '@open-mercato/core/modules/staff/di'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { readTimeTrackingSettings } from '@open-mercato/core/modules/staff/lib/time-tracking/settings'
import { CodeRepository, RepositoryConnection, RepositoryConnectState, RepositoryProjectLink, RepositoryQualificationDispatch } from '../data/entities'
import type { ProjectLinkInput, ProjectLinkRemoveInput, RepositoryRegisterInput, RepositoryUpdateInput } from '../data/validators'
import { parseRepositoryProfile } from '../data/validators'
import { requireRepositoryScope, type RepositoryScope } from '../lib/auth'
import { RepositoryBrokerError, sha256Hex, type RepositoryBroker } from '../lib/broker'
import { canApplyQualificationCallback } from '../lib/qualification-fence'
import { applyAuthoritativeProviderGrant, shouldRequalifyAfterProviderGrant } from '../lib/provider-state'
import { queueRepositoryEventIntent, tryDeliverRepositoryEventIntent } from '../lib/event-outbox'
import {
  REPOSITORY_BROKER,
  dispatchPersistedQualificationAttempt,
  persistedQualificationAttempt,
  queueFreshQualificationAttempt,
  type PersistedQualificationAttempt,
} from '../lib/qualification-dispatch'
import { consumeStagedConnectionGrant, type VerifiedConnectionGrant } from '../lib/verified-connection-grant'
const QUALIFICATION_TIMEOUT_MS = 15 * 60 * 1000

type StartConnectionResult = { redirectUrl: string }
type StartConnectionInput = { installationId?: string }
type CompleteConnectionInput = {
  stateId: string
  verificationId: string
}
type CompleteConnectionResult = {
  status: 'connected'
  connectionId: string
  grantedRepositories: VerifiedConnectionGrant['repositories']
}
type RepositoryResult = { id: string; updatedAt: string; attemptId?: string }
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

function emFrom(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em').fork()
}

function brokerFrom(ctx: CommandRuntimeContext): RepositoryBroker {
  return ctx.container.resolve<RepositoryBroker>(REPOSITORY_BROKER)
}

function repositoryError(status: number, code: string): CrudHttpError {
  return new CrudHttpError(status, { code, error: `repositories.errors.${code}` })
}

async function scopedRepository(em: EntityManager, scope: RepositoryScope, id: string): Promise<CodeRepository> {
  const repository = await em.findOne(CodeRepository, { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
  if (!repository) throw repositoryError(404, 'notFound')
  return repository
}

async function lockedScopedRepository(em: EntityManager, scope: RepositoryScope, id: string): Promise<CodeRepository> {
  const repository = await em.findOne(
    CodeRepository,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!repository) throw repositoryError(404, 'notFound')
  return repository
}

async function scopedConnection(em: EntityManager, scope: RepositoryScope, id: string): Promise<RepositoryConnection> {
  const connection = await em.findOne(RepositoryConnection, { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
  if (!connection) throw repositoryError(404, 'connectionNotFound')
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

async function confirmGrantedRepository(
  broker: RepositoryBroker,
  connection: RepositoryConnection,
  githubRepositoryId: string,
  baseBranch: string,
): Promise<{ id: string; fullName: string; defaultBranch: string }> {
  const grant = await broker.refreshInstallation({ installationId: connection.installationId, authorizationId: connection.brokerAuthorizationId })
  const repository = grant.repositories.find((item) => item.id === githubRepositoryId)
  if (!repository) throw repositoryError(422, 'repositoryNotGranted')
  const branches = await broker.listBranches({ installationId: connection.installationId, authorizationId: connection.brokerAuthorizationId, githubRepositoryId })
  if (!branches.includes(baseBranch)) throw repositoryError(422, 'branchNotGranted')
  return repository
}

async function tryDispatchPersistedQualificationAttempt(
  broker: RepositoryBroker,
  em: EntityManager,
  attempt: PersistedQualificationAttempt,
): Promise<void> {
  try {
    await dispatchPersistedQualificationAttempt(broker, em, attempt)
  } catch {
    // The durable dispatch row remains retryable by the recovery worker.
  }
}

async function prepareQualificationAttempt(
  em: EntityManager,
  connection: RepositoryConnection,
  repository: CodeRepository,
): Promise<PersistedQualificationAttempt> {
  const now = new Date()
  if (repository.qualificationStatus === 'running' && repository.qualificationStartedAt
    && now.getTime() - repository.qualificationStartedAt.getTime() < QUALIFICATION_TIMEOUT_MS) {
    const activeAttemptId = repository.qualificationAttemptId
    const existingDispatch = activeAttemptId
      ? await em.findOne(RepositoryQualificationDispatch, { repositoryId: repository.id, attemptId: activeAttemptId, epoch: repository.configEpoch })
      : null
    if (!activeAttemptId || !existingDispatch || existingDispatch.status === 'accepted') {
      throw repositoryError(409, 'qualificationRunning')
    }
    return persistedQualificationAttempt(connection, repository, activeAttemptId)
  }
  return queueFreshQualificationAttempt(em, connection, repository, now)
}

const startConnectionCommand: CommandHandler<StartConnectionInput, StartConnectionResult> = {
  id: 'repositories.connection.start',
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const broker = brokerFrom(ctx)
    if (!broker.isConfigured()) throw new RepositoryBrokerError('not_configured')
    const rawState = randomBytes(32).toString('base64url')
    const em = emFrom(ctx)
    await em.nativeDelete(RepositoryConnectState, { expiresAt: { $lt: new Date() } } as FilterQuery<RepositoryConnectState>)
    em.persist(em.create(RepositoryConnectState, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      nonceHash: sha256Hex(rawState),
      expectedInstallationId: input.installationId ?? null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }))
    await em.flush()
    return { redirectUrl: input.installationId ? broker.buildAuthorizeUrl(rawState) : broker.buildInstallUrl(rawState) }
  },
  buildLog({ ctx }) {
    return { actionLabel: 'repositories.audit.connection.start', resourceKind: 'repositories.connection', tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId }
  },
}

const completeConnectionCommand: CommandHandler<CompleteConnectionInput, CompleteConnectionResult> = {
  id: 'repositories.connection.complete',
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const grant = consumeStagedConnectionGrant(input.verificationId)
    const em = emFrom(ctx)
    const completed = await em.transactional(async (tx) => {
      const state = await tx.findOne(RepositoryConnectState, {
        id: input.stateId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
        usedAt: null,
        expiresAt: { $gt: new Date() },
      } as FilterQuery<RepositoryConnectState>, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!state) throw repositoryError(400, 'connectionStateExpired')
      if (state.expectedInstallationId && state.expectedInstallationId !== grant.installationId) {
        throw repositoryError(400, 'installationMismatch')
      }
      const existing = await tx.findOne(RepositoryConnection, { provider: 'github', installationId: grant.installationId, deletedAt: null })
      if (existing && (existing.tenantId !== scope.tenantId || existing.organizationId !== scope.organizationId)) {
        throw repositoryError(409, 'installationBound')
      }
      const authorizationChanged = existing !== null && existing.brokerAuthorizationId !== grant.authorizationId
      state.usedAt = new Date()
      const connection = existing ?? tx.create(RepositoryConnection, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        installationId: grant.installationId,
        brokerAuthorizationId: grant.authorizationId,
        accountLogin: grant.accountLogin,
        connectedBy: scope.userId,
      })
      connection.accountLogin = grant.accountLogin
      connection.brokerAuthorizationId = grant.authorizationId
      connection.status = 'active'
      tx.persist([state, connection])
      await tx.flush()
      const attempts: PersistedQualificationAttempt[] = []
      if (existing) {
        const repositories = await tx.find(CodeRepository, { connectionId: connection.id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        for (const repository of repositories) {
          const previousAccessStatus = repository.accessStatus
          const repositoryGrant = grant.repositories.find((item) => item.id === repository.githubRepositoryId) ?? null
          applyAuthoritativeProviderGrant(repository, repositoryGrant)
          if (shouldRequalifyAfterProviderGrant(previousAccessStatus, repository.accessStatus)
            || (authorizationChanged && repository.accessStatus === 'granted')) {
            attempts.push(queueFreshQualificationAttempt(tx, connection, repository))
          }
        }
      }
      const eventIntent = queueRepositoryEventIntent(tx, 'repositories.connection.connected', {
        connectionId: connection.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await tx.flush()
      return { status: 'connected' as const, connectionId: connection.id, grantedRepositories: grant.repositories, attempts, eventIntent }
    })
    for (const attempt of completed.attempts) {
      await tryDispatchPersistedQualificationAttempt(brokerFrom(ctx), em.fork(), attempt)
    }
    await tryDeliverRepositoryEventIntent(em.fork(), completed.eventIntent)
    return { status: completed.status, connectionId: completed.connectionId, grantedRepositories: completed.grantedRepositories }
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.connection.complete', resourceKind: 'repositories.connection', resourceId: result.connectionId, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId }
  },
}

const registerRepositoryCommand: CommandHandler<RepositoryRegisterInput, RepositoryResult> = {
  id: 'repositories.repository.register',
  async execute(rawInput, ctx) {
    const input = { ...rawInput, profile: parseRepositoryProfile(rawInput.kind, rawInput.profile) }
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const em = emFrom(ctx)
    const connection = await scopedConnection(em, scope, input.connectionId)
    if (connection.status !== 'active') throw repositoryError(409, 'connectionUnavailable')
    const grant = await confirmGrantedRepository(brokerFrom(ctx), connection, input.githubRepositoryId, input.baseBranch)
    let committed: { repository: CodeRepository; attempt: PersistedQualificationAttempt; eventIntent: ReturnType<typeof queueRepositoryEventIntent> }
    try {
      committed = await em.transactional(async (tx) => {
        const existing = await tx.findOne(CodeRepository, { organizationId: scope.organizationId, githubRepositoryId: input.githubRepositoryId, deletedAt: null })
        if (existing) throw repositoryError(409, 'alreadyRegistered')
        const currentConnection = await scopedConnection(tx, scope, connection.id)
        if (currentConnection.status !== 'active') throw repositoryError(409, 'connectionUnavailable')
        const repository = tx.create(CodeRepository, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          connectionId: currentConnection.id,
          githubRepositoryId: grant.id,
          fullName: grant.fullName,
          baseBranch: input.baseBranch,
          kind: input.kind,
          profile: input.profile,
        })
        tx.persist(repository)
        await tx.flush()
        const attempt = queueFreshQualificationAttempt(tx, currentConnection, repository)
        const eventIntent = queueRepositoryEventIntent(tx, 'repositories.repository.registered', {
          repositoryId: repository.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        await tx.flush()
        return { repository, attempt, eventIntent }
      })
    } catch (error) {
      if (isUniqueViolation(error, 'repositories_repositories_org_github_uq')) throw repositoryError(409, 'alreadyRegistered')
      throw error
    }
    await tryDispatchPersistedQualificationAttempt(brokerFrom(ctx), em.fork(), committed.attempt)
    await tryDeliverRepositoryEventIntent(em.fork(), committed.eventIntent)
    return { id: committed.repository.id, updatedAt: committed.repository.updatedAt.toISOString(), attemptId: committed.attempt.attemptId }
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.repository.register', resourceKind: 'repositories.repository', resourceId: result.id, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId }
  },
}

const updateRepositoryCommand: CommandHandler<RepositoryUpdateInput & { id: string }, RepositoryResult> = {
  id: 'repositories.repository.update',
  async prepare(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const repository = await scopedRepository(emFrom(ctx), scope, input.id)
    return { before: serializeRepository(repository) }
  },
  async execute(rawInput, ctx) {
    const input = { ...rawInput, profile: parseRepositoryProfile(rawInput.kind, rawInput.profile) }
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const em = emFrom(ctx)
    const observedRepository = await scopedRepository(em, scope, input.id)
    const observedConnection = await scopedConnection(em, scope, observedRepository.connectionId)
    if (observedConnection.status !== 'active') throw repositoryError(409, 'connectionUnavailable')
    await confirmGrantedRepository(brokerFrom(ctx), observedConnection, observedRepository.githubRepositoryId, input.baseBranch)
    const committed = await em.transactional(async (tx) => {
      const repository = await lockedScopedRepository(tx, scope, input.id)
      ensureCurrentVersion(ctx, repository, input.updatedAt)
      const connection = await scopedConnection(tx, scope, repository.connectionId)
      if (connection.status !== 'active') throw repositoryError(409, 'connectionUnavailable')
      const changed = repository.baseBranch !== input.baseBranch
        || repository.kind !== input.kind
        || JSON.stringify(repository.profile) !== JSON.stringify(input.profile)
      if (!changed) return { repository, attempt: null, eventIntent: null }
      repository.baseBranch = input.baseBranch
      repository.kind = input.kind
      repository.profile = input.profile
      repository.configEpoch += 1
      repository.qualificationStatus = 'stale'
      repository.qualificationReport = null
      repository.qualificationEpoch = null
      repository.qualificationAttemptId = null
      repository.qualificationStartedAt = null
      const attempt = await prepareQualificationAttempt(tx, connection, repository)
      const eventIntent = queueRepositoryEventIntent(tx, 'repositories.repository.updated', {
        repositoryId: repository.id,
        configEpoch: repository.configEpoch,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await tx.flush()
      return { repository, attempt, eventIntent }
    })
    if (!committed.attempt) return { id: committed.repository.id, updatedAt: committed.repository.updatedAt.toISOString() }
    await tryDispatchPersistedQualificationAttempt(brokerFrom(ctx), em.fork(), committed.attempt)
    if (committed.eventIntent) await tryDeliverRepositoryEventIntent(em.fork(), committed.eventIntent)
    return { id: committed.repository.id, updatedAt: committed.repository.updatedAt.toISOString(), attemptId: committed.attempt.attemptId }
  },
  captureAfter(_input, result) { return result },
  buildLog({ result, ctx, snapshots }) {
    return { actionLabel: 'repositories.audit.repository.update', resourceKind: 'repositories.repository', resourceId: result.id, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, snapshotBefore: snapshots.before, snapshotAfter: snapshots.after }
  },
}

const qualifyRepositoryCommand: CommandHandler<VersionedRepositoryInput, RepositoryResult> = {
  id: 'repositories.repository.qualify',
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const em = emFrom(ctx)
    const committed = await em.transactional(async (tx) => {
      const repository = await lockedScopedRepository(tx, scope, input.id)
      ensureCurrentVersion(ctx, repository, input.updatedAt)
      if (repository.status !== 'active' || repository.accessStatus !== 'granted') throw repositoryError(409, 'repositoryUnavailable')
      const connection = await scopedConnection(tx, scope, repository.connectionId)
      if (connection.status !== 'active') throw repositoryError(409, 'connectionUnavailable')
      const attempt = await prepareQualificationAttempt(tx, connection, repository)
      await tx.flush()
      return { repository, attempt }
    })
    await tryDispatchPersistedQualificationAttempt(brokerFrom(ctx), em.fork(), committed.attempt)
    return { id: committed.repository.id, updatedAt: committed.repository.updatedAt.toISOString(), attemptId: committed.attempt.attemptId }
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.repository.qualify', resourceKind: 'repositories.repository', resourceId: result.id, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId }
  },
}

function statusCommand(status: 'active' | 'disabled'): CommandHandler<VersionedRepositoryInput, RepositoryResult> {
  return {
    id: `repositories.repository.${status === 'active' ? 'enable' : 'disable'}`,
    isUndoable: true,
    async prepare(input, ctx) {
      const scope = await requireRepositoryScope(ctx, 'repositories.manage')
      const repository = await scopedRepository(emFrom(ctx), scope, input.id)
      return { before: { id: repository.id, status: repository.status, updatedAt: repository.updatedAt.toISOString() } satisfies RepositoryStatusSnapshot }
    },
    async execute(input, ctx) {
      const scope = await requireRepositoryScope(ctx, 'repositories.manage')
      const em = emFrom(ctx)
      const committed = await em.transactional(async (tx) => {
        const locked = await lockedScopedRepository(tx, scope, input.id)
        ensureCurrentVersion(ctx, locked, input.updatedAt)
        locked.status = status
        const eventIntent = queueRepositoryEventIntent(tx, 'repositories.repository.status_changed', {
          repositoryId: locked.id,
          status,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        await tx.flush()
        return { repository: locked, eventIntent }
      })
      await tryDeliverRepositoryEventIntent(em.fork(), committed.eventIntent)
      return { id: committed.repository.id, updatedAt: committed.repository.updatedAt.toISOString() }
    },
    captureAfter(_input, result) { return result },
    buildLog({ result, ctx, snapshots }) {
      return {
        actionLabel: `repositories.audit.repository.${status}`,
        resourceKind: 'repositories.repository',
        resourceId: result.id,
        tenantId: ctx.auth?.tenantId,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId,
        payload: { undo: { before: snapshots.before, changedUpdatedAt: result.updatedAt } },
        snapshotBefore: snapshots.before,
        snapshotAfter: snapshots.after,
      }
    },
    async undo({ ctx, logEntry }) {
      const undo = extractUndoPayload<RepositoryStatusUndoPayload>(logEntry)
      if (!undo) return
      const scope = await requireRepositoryScope(ctx, 'repositories.manage')
      const em = emFrom(ctx)
      const eventIntent = await em.transactional(async (tx) => {
        const locked = await lockedScopedRepository(tx, scope, undo.before.id)
        ensureCurrentVersion(ctx, locked, undo.changedUpdatedAt)
        locked.status = undo.before.status
        const intent = queueRepositoryEventIntent(tx, 'repositories.repository.status_changed', {
          repositoryId: locked.id,
          status: undo.before.status,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        await tx.flush()
        return intent
      })
      await tryDeliverRepositoryEventIntent(em.fork(), eventIntent)
    },
  }
}

const disableRepositoryCommand = statusCommand('disabled')
const enableRepositoryCommand = statusCommand('active')

const removeRepositoryCommand: CommandHandler<VersionedRepositoryInput, RepositoryResult> = {
  id: 'repositories.repository.remove',
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.manage')
    const em = emFrom(ctx)
    const hasDelegations = typeof (ctx.container as { hasRegistration?: (name: string) => boolean }).hasRegistration === 'function'
      && ctx.container.hasRegistration('TaskDelegation')
    if (hasDelegations) {
      const TaskDelegation = ctx.container.resolve<typeof CodeRepository>('TaskDelegation')
      const active = await em.findOne(TaskDelegation, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        repositoryId: input.id,
        releasedAt: null,
      } as never)
      if (active) throw repositoryError(409, 'activeDelegations')
    }
    const committed = await em.transactional(async (tx) => {
      const locked = await lockedScopedRepository(tx, scope, input.id)
      ensureCurrentVersion(ctx, locked, input.updatedAt)
      if (locked.status !== 'disabled') throw repositoryError(409, 'disableBeforeRemove')
      const links = await tx.find(RepositoryProjectLink, { tenantId: scope.tenantId, organizationId: scope.organizationId, repositoryId: locked.id })
      const eventIntents = links.map((link) => queueRepositoryEventIntent(tx, 'repositories.project_link.changed', {
        projectId: link.projectId,
        repositoryId: locked.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }))
      for (const link of links) tx.remove(link)
      locked.deletedAt = new Date()
      await tx.flush()
      return { repository: locked, eventIntents }
    })
    for (const intent of committed.eventIntents) await tryDeliverRepositoryEventIntent(em.fork(), intent)
    return { id: committed.repository.id, updatedAt: committed.repository.updatedAt.toISOString() }
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.repository.remove', resourceKind: 'repositories.repository', resourceId: result.id, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId }
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
        const eventIntent = queueRepositoryEventIntent(tx, 'repositories.project_link.changed', {
          projectId: input.projectId,
          repositoryId: input.repositoryId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        await tx.flush()
        return {
          link: next,
          eventIntent,
          undoState: {
            beforeLink,
            beforeDefault,
            changedDefaultUpdatedAt: changedDefault?.updatedAt.toISOString() ?? null,
          } satisfies ProjectLinkUndoState,
        }
      })
      await tryDeliverRepositoryEventIntent(em.fork(), committed.eventIntent)
      const link = committed.link
      return { id: link.id, projectId: link.projectId, repositoryId: link.repositoryId, isDefault: link.isDefault, updatedAt: link.updatedAt.toISOString(), undoState: committed.undoState }
    } catch (error) {
      if (isUniqueViolation(error, 'repositories_project_links_org_project_repository_uq')
        || isUniqueViolation(error, 'repositories_project_links_org_project_default_uq')) throw repositoryError(409, 'projectLinkChanged')
      throw error
    }
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.projectLink.set', resourceKind: 'repositories.project_link', resourceId: result.id, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, payload: { undo: { result, state: result.undoState } }, context: result }
  },
  async undo({ ctx, logEntry }) {
    const undo = extractUndoPayload<{ result: ProjectLinkResult; state: ProjectLinkUndoState }>(logEntry)
    if (!undo?.state) return
    const scope = await requireRepositoryScope(ctx, 'repositories.link')
    const em = emFrom(ctx)
    await requireProjectAccess(ctx, em, scope, undo.result.projectId)
    const eventIntent = await em.transactional(async (tx) => {
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
      const intent = queueRepositoryEventIntent(tx, 'repositories.project_link.changed', {
        projectId: undo.result.projectId,
        repositoryId: undo.result.repositoryId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await tx.flush()
      return intent
    })
    await tryDeliverRepositoryEventIntent(em.fork(), eventIntent)
  },
}

const removeProjectLinkCommand: CommandHandler<ProjectLinkRemoveInput, ProjectLinkResult> = {
  id: 'repositories.project_link.remove',
  isUndoable: true,
  async execute(input, ctx) {
    const scope = await requireRepositoryScope(ctx, 'repositories.link')
    const em = emFrom(ctx)
    await requireProjectAccess(ctx, em, scope, input.projectId)
    const committed = await em.transactional(async (tx) => {
      const link = await tx.findOne(RepositoryProjectLink, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!link) throw repositoryError(404, 'projectLinkNotFound')
      ensureLinkVersion(link, input.updatedAt)
      const snapshot = projectLinkSnapshot(link)
      const result = { id: link.id, projectId: link.projectId, repositoryId: link.repositoryId, isDefault: link.isDefault, updatedAt: link.updatedAt.toISOString(), undoState: { beforeLink: snapshot, beforeDefault: null, changedDefaultUpdatedAt: null } }
      tx.remove(link)
      const eventIntent = queueRepositoryEventIntent(tx, 'repositories.project_link.changed', {
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await tx.flush()
      return { result, eventIntent }
    })
    await tryDeliverRepositoryEventIntent(em.fork(), committed.eventIntent)
    return committed.result
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'repositories.audit.projectLink.remove', resourceKind: 'repositories.project_link', resourceId: result.id, tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, payload: { undo: result.undoState?.beforeLink }, context: result }
  },
  async undo({ ctx, logEntry }) {
    const snapshot = extractUndoPayload<ProjectLinkSnapshot>(logEntry)
    if (!snapshot) return
    const scope = await requireRepositoryScope(ctx, 'repositories.link')
    const em = emFrom(ctx)
    await requireProjectAccess(ctx, em, scope, snapshot.projectId)
    const eventIntent = await em.transactional(async (tx) => {
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
      const intent = queueRepositoryEventIntent(tx, 'repositories.project_link.changed', {
        projectId: snapshot.projectId,
        repositoryId: snapshot.repositoryId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await tx.flush()
      return intent
    })
    await tryDeliverRepositoryEventIntent(em.fork(), eventIntent)
  },
}

function serializeRepository(repository: CodeRepository): Record<string, unknown> {
  return {
    id: repository.id,
    baseBranch: repository.baseBranch,
    kind: repository.kind,
    profile: repository.profile,
    configEpoch: repository.configEpoch,
    qualificationStatus: repository.qualificationStatus,
    status: repository.status,
    updatedAt: repository.updatedAt.toISOString(),
  }
}

registerCommand(startConnectionCommand)
registerCommand(completeConnectionCommand)
registerCommand(registerRepositoryCommand)
registerCommand(updateRepositoryCommand)
registerCommand(qualifyRepositoryCommand)
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
  qualifyRepositoryCommand,
  disableRepositoryCommand,
  enableRepositoryCommand,
  removeRepositoryCommand,
  setProjectLinkCommand,
  removeProjectLinkCommand,
}

export { canApplyQualificationCallback }
