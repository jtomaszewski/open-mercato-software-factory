import { beforeEach, expect, it, jest } from '@jest/globals'
import { clearWorkflowSafeCommandsForTests, listWorkflowSafeCommands, registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import features from '../acl'
import { setup } from '../setup'
import { CODE_CHANGES_WORKFLOW_COMMAND_IDS } from '../workflows'

const getValue = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const setValue = jest.fn<(...args: unknown[]) => Promise<void>>()

beforeEach(() => {
  getValue.mockReset().mockResolvedValue(null)
  setValue.mockReset().mockResolvedValue(undefined)
  clearWorkflowSafeCommandsForTests()
  registerWorkflowSafeCommands([
    { commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'], defaultEnabled: true },
    ...CODE_CHANGES_WORKFLOW_COMMAND_IDS.map((commandId) => ({ commandId, requiredFeatures: ['task_delegation.process'] as [string, ...string[]] })),
  ])
})

it('grants every declared feature to a role, and grants deciding to nobody by default beyond admins', () => {
  const declared = features.map((feature) => feature.id)
  expect(declared).toEqual(['code_changes.view', 'code_changes.decide'])
  // A feature nobody is granted is a feature nobody can use; a wildcard covers both for admins.
  expect(setup.defaultRoleFeatures?.superadmin).toEqual(['code_changes.*'])
  expect(setup.defaultRoleFeatures?.admin).toEqual(['code_changes.*'])
  // Merging into a repository is not an ordinary employee's call, so they only read.
  expect(setup.defaultRoleFeatures?.employee).toEqual(['code_changes.view'])
})

it('declares a dependency from deciding to viewing, so a decider can always read what they decide', () => {
  const decide = features.find((feature) => feature.id === 'code_changes.decide')
  expect(decide?.dependsOn).toEqual(['code_changes.view'])
})

it('offers only the run commands as workflow steps — a workflow can never be the task assignee', () => {
  expect([...CODE_CHANGES_WORKFLOW_COMMAND_IDS]).toEqual([
    'code_changes.change_request.start',
    'code_changes.change_request.record_pull_request',
    'code_changes.change_request.mark_failed',
  ])
  const offered = listWorkflowSafeCommands().map((command) => command.commandId)
  expect(offered).not.toContain('code_changes.change_request.approve')
  expect(offered).not.toContain('code_changes.change_request.reject')
})

it('enables the change-request workflow commands without dropping stored ones', async () => {
  const container = { resolve: () => ({ getValue, setValue }) }
  await setup.seedDefaults?.({ container, tenantId: 'tenant-id', organizationId: 'org-id', em: {} } as never)
  expect(setValue).toHaveBeenCalledWith(
    'workflows', 'update_entity_enabled_commands',
    ['sales.orders.update', ...CODE_CHANGES_WORKFLOW_COMMAND_IDS],
    { tenantId: 'tenant-id' },
  )

  getValue.mockResolvedValueOnce(['custom.command'])
  await setup.seedDefaults?.({ container, tenantId: 'tenant-id', organizationId: 'org-id', em: {} } as never)
  expect(setValue).toHaveBeenLastCalledWith(
    'workflows', 'update_entity_enabled_commands',
    ['custom.command', ...CODE_CHANGES_WORKFLOW_COMMAND_IDS],
    { tenantId: 'tenant-id' },
  )
})
