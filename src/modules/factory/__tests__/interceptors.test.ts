import { beforeEach, expect, it, jest } from '@jest/globals'

const loadOrderStatus = jest.fn<(em: unknown, scope: unknown, orderId: string) => Promise<string | null>>()
jest.mock('../lib/orderRecord', () => ({ FULFILLED_STATUS: 'fulfilled', loadOrderStatus: (em: unknown, scope: unknown, orderId: string) => loadOrderStatus(em, scope, orderId) }))
const emit = jest.fn<(...args: unknown[]) => Promise<void>>()
jest.mock('../events', () => ({ emitFactoryEvent: (...args: unknown[]) => emit(...args) }))

import { interceptors } from '../commands/interceptors'

const [interceptor] = interceptors
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const context = (metadata?: Record<string, unknown>) => ({
  commandId: 'sales.orders.update',
  auth: { sub: 'user-1', tenantId: scope.tenantId, orgId: scope.organizationId },
  selectedOrganizationId: scope.organizationId,
  container: { resolve: () => ({ fork: () => ({}) }) },
  metadata,
}) as never

beforeEach(() => {
  loadOrderStatus.mockReset()
  emit.mockReset().mockResolvedValue(undefined)
})

it('targets the order update command', () => {
  expect(interceptor!.targetCommand).toBe('sales.orders.update')
})

it('emits factory.order.fulfilled, scoped from the caller, only on the switch to fulfilled', async () => {
  loadOrderStatus.mockResolvedValueOnce('confirmed')
  const before = await interceptor!.beforeExecute!({ id: 'order-1', tenantId: 'forged' }, context())
  expect(before).toEqual({ ok: true, metadata: { previousStatus: 'confirmed' } })

  loadOrderStatus.mockResolvedValueOnce('fulfilled')
  await interceptor!.afterExecute!({ id: 'order-1' }, {}, context({ previousStatus: 'confirmed' }))
  expect(loadOrderStatus).toHaveBeenLastCalledWith(expect.anything(), scope, 'order-1')
  expect(emit).toHaveBeenCalledWith('factory.order.fulfilled', { id: 'order-1', ...scope }, { persistent: true, ...scope })
})

it('stays quiet when the order was already fulfilled or is not fulfilled now', async () => {
  await interceptor!.afterExecute!({ id: 'order-1' }, {}, context({ previousStatus: 'fulfilled' }))
  loadOrderStatus.mockResolvedValueOnce('in_fulfillment')
  await interceptor!.afterExecute!({ id: 'order-1' }, {}, context({ previousStatus: 'confirmed' }))
  expect(emit).not.toHaveBeenCalled()
})

it('never fails the saved order when the reference request cannot be emitted', async () => {
  loadOrderStatus.mockResolvedValueOnce('fulfilled')
  emit.mockRejectedValueOnce(new Error('bus down'))
  await expect(interceptor!.afterExecute!({ id: 'order-1' }, {}, context({ previousStatus: 'confirmed' }))).resolves.toBeUndefined()
})
