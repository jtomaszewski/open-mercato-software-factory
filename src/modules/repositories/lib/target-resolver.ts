import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CodeRepository, RepositoryConnection, RepositoryProjectLink, type RepositoryProfileKind } from '../data/entities'
import { chooseRepositoryTarget, repositoryProfileDigest } from './target-selection'

export const REPOSITORY_TARGET_RESOLVER = 'repositoryTargetResolver'

export type RepositoryTargetReason = 'repository_unavailable' | 'repository_changed'

export type RepositoryTargetOption = {
  id: string
  fullName: string
  kind: RepositoryProfileKind
  isDefault: boolean
  usable: boolean
  reason?: RepositoryTargetReason
  updatedAt: string
}

export type ResolvedRepositoryTarget = {
  repositoryId: string
  projectId: string
  fullName: string
  baseBranch: string
  kind: RepositoryProfileKind
  profile: Record<string, unknown>
  configEpoch: number
  profileDigest: string
  githubRepositoryId: string
  installationId: string
  brokerAuthorizationId: string
}

export type RepositoryTargetResolver = {
  listProjectTargets(input: { tenantId: string; organizationId: string; projectId: string }): Promise<RepositoryTargetOption[]>
  resolveForProject(input: { tenantId: string; organizationId: string; projectId: string; repositoryId?: string }): Promise<ResolvedRepositoryTarget>
  resolveDelegationTarget(input: { tenantId?: string; organizationId?: string; delegationId: string }): Promise<ResolvedRepositoryTarget>
}

type DelegationBinding = {
  id: string
  projectId: string
  repositoryId?: string | null
  repositoryConfigEpoch?: number | null
  repositoryProfileDigest?: string | null
  releasedAt?: Date | null
}

type EntityClass<T> = abstract new (...args: never[]) => T

function targetError(status: number, code: string): CrudHttpError {
  return new CrudHttpError(status, { code, error: `repositories.errors.${code}` })
}

function currentReason(repository: CodeRepository, connection: RepositoryConnection): RepositoryTargetReason | undefined {
  if (repository.status !== 'active' || repository.accessStatus !== 'granted' || connection.status !== 'active') return 'repository_unavailable'
  if (repository.qualificationStatus !== 'passed' || repository.qualificationEpoch !== repository.configEpoch) return 'repository_changed'
  return undefined
}

export function createRepositoryTargetResolver({ em, TaskDelegation }: { em: EntityManager; TaskDelegation: EntityClass<DelegationBinding> }): RepositoryTargetResolver {
  async function records(input: { tenantId: string; organizationId: string; projectId: string }) {
    const manager = em.fork()
    const links = await manager.find(RepositoryProjectLink, input, { orderBy: { createdAt: 'asc' } })
    const targets = await Promise.all(links.map(async (link) => {
      const repository = await manager.findOne(CodeRepository, {
        id: link.repositoryId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        deletedAt: null,
      })
      if (!repository) return null
      const connection = await manager.findOne(RepositoryConnection, {
        id: repository.connectionId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        deletedAt: null,
      })
      if (!connection) return null
      return { link, repository, connection, reason: currentReason(repository, connection) }
    }))
    return targets.filter((target): target is NonNullable<typeof target> => target !== null)
  }

  async function listProjectTargets(input: { tenantId: string; organizationId: string; projectId: string }): Promise<RepositoryTargetOption[]> {
    return (await records(input)).map(({ link, repository, reason }) => ({
      id: repository.id,
      fullName: repository.fullName,
      kind: repository.kind,
      isDefault: link.isDefault,
      usable: reason === undefined,
      ...(reason ? { reason } : {}),
      updatedAt: link.updatedAt.toISOString(),
    }))
  }

  async function resolveForProject(input: { tenantId: string; organizationId: string; projectId: string; repositoryId?: string }): Promise<ResolvedRepositoryTarget> {
    const available = await records(input)
    let selected: (typeof available)[number]
    try {
      selected = chooseRepositoryTarget(available.map((target) => ({ ...target, id: target.repository.id, isDefault: target.link.isDefault, usable: !target.reason })), input.repositoryId)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'repository_required'
      throw targetError(422, code)
    }
    const { repository, connection } = selected
    return {
      repositoryId: repository.id,
      projectId: input.projectId,
      fullName: repository.fullName,
      baseBranch: repository.baseBranch,
      kind: repository.kind,
      profile: repository.profile,
      configEpoch: repository.configEpoch,
      profileDigest: repositoryProfileDigest(repository.profile),
      githubRepositoryId: repository.githubRepositoryId,
      installationId: connection.installationId,
      brokerAuthorizationId: connection.brokerAuthorizationId,
    }
  }

  async function resolveDelegationTarget(input: { tenantId?: string; organizationId?: string; delegationId: string }): Promise<ResolvedRepositoryTarget> {
    const manager = em.fork()
    const delegation = await manager.findOne(TaskDelegation, {
      id: input.delegationId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      releasedAt: null,
    })
    if (!delegation?.repositoryId || !delegation.repositoryConfigEpoch || !delegation.repositoryProfileDigest) {
      throw targetError(409, 'binding_unavailable')
    }
    const tenantId = (delegation as DelegationBinding & { tenantId: string }).tenantId
    const organizationId = (delegation as DelegationBinding & { organizationId: string }).organizationId
    const linked = await manager.findOne(RepositoryProjectLink, {
      tenantId,
      organizationId,
      projectId: delegation.projectId,
      repositoryId: delegation.repositoryId,
    })
    if (!linked) throw targetError(422, 'repository_not_linked')
    const target = await resolveForProject({ tenantId, organizationId, projectId: delegation.projectId, repositoryId: delegation.repositoryId })
    if (target.configEpoch !== delegation.repositoryConfigEpoch || target.profileDigest !== delegation.repositoryProfileDigest) {
      throw targetError(409, 'repository_changed')
    }
    return target
  }

  return { listProjectTargets, resolveForProject, resolveDelegationTarget }
}
