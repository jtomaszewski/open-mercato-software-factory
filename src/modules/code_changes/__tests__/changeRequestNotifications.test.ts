import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  CHANGE_REQUEST_SOURCE,
  clearChangeRequestNotifications,
  notifyChangeRequest,
} from '../lib/changeRequestNotifications'

const createForFeature = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const deleteBySource = jest.fn<(...args: unknown[]) => Promise<number>>()
const findOne = jest.fn<(...args: unknown[]) => Promise<unknown>>()

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature, deleteBySource }),
}))

const PAYLOAD = { changeRequestId: 'cr-1', tenantId: 't-1', organizationId: 'o-1' }

function ctx() {
  const services: Record<string, unknown> = {
    em: { fork: () => ({ findOne }) },
    eventBus: { emit: async () => {} },
  }
  return { resolve: <T = unknown>(name: string) => services[name] as T }
}

function changeRequest(overrides: Record<string, unknown> = {}) {
  return { id: 'cr-1', title: 'Add the reference', status: 'open', statusReason: null, ...overrides }
}

beforeEach(() => {
  createForFeature.mockReset().mockResolvedValue([])
  deleteBySource.mockReset().mockResolvedValue(1)
  findOne.mockReset().mockResolvedValue(changeRequest())
})

describe('notifyChangeRequest', () => {
  it('asks the people who may decide, and links to the change', async () => {
    await notifyChangeRequest('ready', PAYLOAD, ctx())

    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input, scope] = createForFeature.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(input).toMatchObject({
      type: 'code_changes.change_request.ready',
      requiredFeature: 'code_changes.decide',
      restrictRecipientsToOrganization: true,
      sourceEntityType: CHANGE_REQUEST_SOURCE,
      sourceEntityId: 'cr-1',
      linkHref: '/backend/code/changes/cr-1',
      groupKey: 'cr-1',
    })
    expect(input.bodyVariables).toMatchObject({ title: 'Add the reference' })
    expect(scope).toEqual({ tenantId: 't-1', organizationId: 'o-1' })
  })

  it('tells the people who may delegate that a run produced nothing, with the reason', async () => {
    findOne.mockResolvedValue(changeRequest({ status: 'failed', statusReason: 'build failed' }))

    await notifyChangeRequest('failed', PAYLOAD, ctx())

    const [input] = createForFeature.mock.calls[0] as [Record<string, unknown>]
    expect(input).toMatchObject({
      type: 'code_changes.change_request.failed',
      requiredFeature: 'task_delegation.delegate',
    })
    expect(input.bodyVariables).toMatchObject({ reason: 'build failed' })
  })

  it('never leaves the failure body ending on a colon', async () => {
    findOne.mockResolvedValue(changeRequest({ status: 'failed', statusReason: '   ' }))

    await notifyChangeRequest('failed', PAYLOAD, ctx())

    const [input] = createForFeature.mock.calls[0] as [Record<string, unknown>]
    expect((input.bodyVariables as Record<string, string>).reason).toBe('—')
  })

  it('does not ask for a decision on a change that has already been decided', async () => {
    findOne.mockResolvedValue(changeRequest({ status: 'approved' }))

    await notifyChangeRequest('ready', PAYLOAD, ctx())

    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('stays silent when the change request is gone or the scope is incomplete', async () => {
    findOne.mockResolvedValue(null)
    await notifyChangeRequest('ready', PAYLOAD, ctx())

    findOne.mockResolvedValue(changeRequest())
    await notifyChangeRequest('ready', { ...PAYLOAD, organizationId: null }, ctx())

    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('keeps a notification failure from failing the event for every other subscriber', async () => {
    createForFeature.mockRejectedValue(new Error('bell is down'))

    await expect(notifyChangeRequest('ready', PAYLOAD, ctx())).resolves.toBeUndefined()
  })
})

describe('clearChangeRequestNotifications', () => {
  it('removes the pending decision from every bell it reached', async () => {
    await clearChangeRequestNotifications(PAYLOAD, ctx())

    expect(deleteBySource).toHaveBeenCalledWith(CHANGE_REQUEST_SOURCE, 'cr-1', {
      tenantId: 't-1',
      organizationId: 'o-1',
    })
  })

  it('does nothing without a scoped change request', async () => {
    await clearChangeRequestNotifications({ changeRequestId: 'cr-1' }, ctx())

    expect(deleteBySource).not.toHaveBeenCalled()
  })
})
