import { beforeEach, expect, it, jest } from '@jest/globals'
import { clearWorkflowSafeCommandsForTests, registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { setup } from '../setup'
import '../workflows'

const getValue = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const setValue = jest.fn<(...args: unknown[]) => Promise<void>>()

beforeEach(() => {
  getValue.mockReset().mockResolvedValue(null)
  setValue.mockReset().mockResolvedValue(undefined)
  clearWorkflowSafeCommandsForTests()
  registerWorkflowSafeCommands([
    { commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'], defaultEnabled: true },
    { commandId: 'tasks.task.set_status', requiredFeatures: ['tasks.process'] },
    { commandId: 'tasks.task.link', requiredFeatures: ['tasks.process'] },
    { commandId: 'tasks.task.create_followup', requiredFeatures: ['tasks.process'] },
  ])
})

it('enables task workflow commands without dropping grandfathered or stored commands', async () => {
  const container = { resolve: () => ({ getValue, setValue }) }
  await setup.seedDefaults?.({ container, tenantId: 'tenant-id', organizationId: 'org-id', em: {} } as never)
  expect(setValue).toHaveBeenCalledWith(
    'workflows',
    'update_entity_enabled_commands',
    ['sales.orders.update', 'tasks.task.set_status', 'tasks.task.link', 'tasks.task.create_followup'],
    { tenantId: 'tenant-id' },
  )

  getValue.mockResolvedValueOnce(['custom.command'])
  await setup.seedDefaults?.({ container, tenantId: 'tenant-id', organizationId: 'org-id', em: {} } as never)
  expect(setValue).toHaveBeenLastCalledWith(
    'workflows',
    'update_entity_enabled_commands',
    ['custom.command', 'tasks.task.set_status', 'tasks.task.link', 'tasks.task.create_followup'],
    { tenantId: 'tenant-id' },
  )
})
