import { beforeEach, expect, it, jest } from '@jest/globals'

const findOneWithDecryption = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args) }))

import { renameAgentPrincipal } from '../renameAgent'

const scope = { tenantId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' }
const execute = jest.fn<(id: string, args: { input: Record<string, unknown> }) => Promise<unknown>>()
const resolvePrincipal = jest.fn<(...args: unknown[]) => Promise<{ userId: string } | null>>()

function container(options: { orchestrator?: boolean } = {}) {
  const services: Record<string, unknown> = {
    em: { fork: () => ({}) },
    commandBus: { execute },
    agentPrincipalService: { resolve: resolvePrincipal },
  }
  return {
    resolve: (name: string) => services[name],
    hasRegistration: (name: string) => name !== 'agentPrincipalService' || options.orchestrator !== false,
  } as never
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue({})
  resolvePrincipal.mockReset().mockResolvedValue({ userId: 'agent-user' })
  findOneWithDecryption.mockReset().mockResolvedValue({ id: 'agent-user', kind: 'agent', name: 'Factory' })
})

it('renames the principal through the auth command, keeping its user id', async () => {
  const result = await renameAgentPrincipal(container(), scope)

  expect(resolvePrincipal).toHaveBeenCalledWith(scope, 'developer')
  expect(execute).toHaveBeenCalledTimes(1)
  const [commandId, args] = execute.mock.calls[0]!
  expect(commandId).toBe('auth.users.update')
  // Only the name moves: an email or roles key here would silently rewrite the principal.
  expect(args.input).toEqual({ id: 'agent-user', name: 'Software Engineer' })
  expect(result).toEqual({ outcome: 'renamed', userId: 'agent-user', previousName: 'Factory' })
})

it('is a no-op on a second run, issuing no command', async () => {
  findOneWithDecryption.mockResolvedValue({ id: 'agent-user', kind: 'agent', name: 'Software Engineer' })

  const result = await renameAgentPrincipal(container(), scope)

  expect(execute).not.toHaveBeenCalled()
  expect(result).toEqual({ outcome: 'unchanged', userId: 'agent-user', previousName: 'Software Engineer' })
})

it('falls back to a principal still carrying the pre-rename id', async () => {
  resolvePrincipal.mockImplementation(async (_scope, agentDefinitionId) => (agentDefinitionId === 'factory' ? { userId: 'agent-user' } : null))

  const result = await renameAgentPrincipal(container(), scope)

  expect(resolvePrincipal.mock.calls.map(([, id]) => id)).toEqual(['developer', 'factory'])
  expect(result.outcome).toBe('renamed')
})

it('reports an organization that never provisioned the agent', async () => {
  resolvePrincipal.mockResolvedValue(null)

  const result = await renameAgentPrincipal(container(), scope)

  expect(execute).not.toHaveBeenCalled()
  expect(result).toEqual({ outcome: 'not-provisioned', userId: null, previousName: null })
})

it('pins the user lookup to the scope and to an agent, not just the principal id', async () => {
  await renameAgentPrincipal(container(), scope)

  // `resolveAgentPrincipal` matches on organizationId alone, so repeating the scope here is what
  // stops a mistyped --tenant from reaching another tenant's row — and `kind` from reaching a person.
  const [, , filter, , decryptScope] = findOneWithDecryption.mock.calls[0]!
  expect(filter).toEqual({ ...scope, id: 'agent-user', kind: 'agent', deletedAt: null })
  expect(decryptScope).toEqual(scope)
})

it('reports a principal whose user row is gone rather than throwing', async () => {
  findOneWithDecryption.mockResolvedValue(null)

  const result = await renameAgentPrincipal(container(), scope)

  expect(execute).not.toHaveBeenCalled()
  expect(result).toEqual({ outcome: 'not-provisioned', userId: null, previousName: null })
})

it('reports a deployment without the orchestrator without resolving anything', async () => {
  const result = await renameAgentPrincipal(container({ orchestrator: false }), scope)

  expect(resolvePrincipal).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
  expect(result).toEqual({ outcome: 'orchestrator-disabled', userId: null, previousName: null })
})
