import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { DEVELOPER_AGENT_DISPLAY_NAME, DEVELOPER_AGENT_IDS } from './agentIdentity'
import { systemContext, type TaskDelegationScope } from './systemContext'

/**
 * `agentPrincipalService` as this module consumes it. Structural on purpose: the enterprise
 * orchestrator is optional, so nothing here may depend on its entity classes being loadable.
 */
type AgentPrincipalService = {
  resolve(scope: TaskDelegationScope, agentDefinitionId: string): Promise<{ userId: string } | null>
}

export type RenameAgentOutcome =
  /** The principal's name was something else and is now the display name. */
  | 'renamed'
  /** The principal already reads as the display name — a repeated run. */
  | 'unchanged'
  /** This organization never ran `seed-demo`, so there is no principal to rename. */
  | 'not-provisioned'
  /** The enterprise orchestrator is disabled in this deployment; agents do not exist here. */
  | 'orchestrator-disabled'

export type RenameAgentResult = {
  outcome: RenameAgentOutcome
  userId: string | null
  previousName: string | null
}

/**
 * Renames the delegatable agent's principal to {@link DEVELOPER_AGENT_DISPLAY_NAME} (SPEC-008).
 *
 * Provisioning writes `auth.User.name` only on the branch that creates the user, so re-running
 * `seed-demo` against a database seeded before the rename looks like it worked and changes
 * nothing. This step is what actually moves the name there, addressed by the principal's `userId`
 * so the same user, its role links and its delegation history all survive.
 *
 * The write goes through `auth.users.update` rather than the ORM: the command owns the name's
 * encryption, the audit entry and the CRUD side effects, and it touches no other column. Every
 * outcome other than `renamed` issues no command at all, which is what makes repeated runs safe.
 */
export async function renameAgentPrincipal(
  container: AwilixContainer,
  scope: TaskDelegationScope,
): Promise<RenameAgentResult> {
  const nothingToDo = (outcome: RenameAgentOutcome): RenameAgentResult =>
    ({ outcome, userId: null, previousName: null })

  const hasRegistration = (container as { hasRegistration?: (name: string) => boolean }).hasRegistration
  if (typeof hasRegistration !== 'function' || !hasRegistration.call(container, 'agentPrincipalService')) {
    return nothingToDo('orchestrator-disabled')
  }

  const service = container.resolve<AgentPrincipalService>('agentPrincipalService')
  let principal: { userId: string } | null = null
  for (const agentDefinitionId of DEVELOPER_AGENT_IDS) {
    principal = await service.resolve(scope, agentDefinitionId)
    if (principal) break
  }
  if (!principal) return nothingToDo('not-provisioned')

  const em = (container.resolve('em') as EntityManager).fork()
  // `name` is encrypted at rest, so the current value only exists on the decrypted row. The scope
  // is repeated in the filter, not just as the decryption scope: `resolveAgentPrincipal` matches
  // on `organizationId` alone, so a mistyped `--tenant` would otherwise reach another tenant's
  // user by id. `kind` pins it to an agent, so this can never rename a person.
  const user = await findOneWithDecryption(
    em,
    User,
    { ...scope, id: principal.userId, kind: 'agent', deletedAt: null },
    {},
    scope,
  )
  if (!user) return nothingToDo('not-provisioned')

  const previousName = user.name ?? null
  if (previousName === DEVELOPER_AGENT_DISPLAY_NAME) {
    return { outcome: 'unchanged', userId: principal.userId, previousName }
  }

  await container.resolve<CommandBus>('commandBus').execute('auth.users.update', {
    input: { id: principal.userId, name: DEVELOPER_AGENT_DISPLAY_NAME },
    ctx: systemContext(container, scope),
  })

  return { outcome: 'renamed', userId: principal.userId, previousName }
}
