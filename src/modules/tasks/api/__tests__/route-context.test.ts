import { beforeEach, expect, it, jest } from '@jest/globals'
import { withTaskRoute, type TaskRouteContext } from '../route-context'

const mockAuth = jest.fn<() => Promise<unknown>>()
const mockScope = jest.fn<() => Promise<unknown>>()
const mockAllowed = jest.fn<(...args: unknown[]) => Promise<boolean>>()
const mockGranted = jest.fn<() => Promise<string[]>>()
const container = { resolve: jest.fn(() => ({ userHasAllFeatures: mockAllowed, getGrantedFeatures: mockGranted })) }
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => mockAuth() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => container }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: () => mockScope() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))

const request = new Request('http://localhost/api/tasks/delegations')

beforeEach(() => {
  mockAuth.mockResolvedValue({ sub: 'user', tenantId: 'tenant', orgId: 'organization' })
  mockScope.mockResolvedValue({ selectedId: 'organization', tenantId: 'tenant', allowedIds: ['organization'], filterIds: ['organization'] })
  mockAllowed.mockResolvedValue(true)
  mockGranted.mockResolvedValue(['tasks.*'])
})

it.each([
  ['unauthenticated', null, {}, 401],
  ['missing tenant', { sub: 'user' }, {}, 403],
  ['rejected selection', { sub: 'user', tenantId: 'tenant' }, { selectedId: 'foreign', selectionRejected: true }, 403],
  ['all organizations', { sub: 'user', tenantId: 'tenant' }, { selectedId: null }, 403],
])('rejects %s before calling the handler', async (_name, auth, scope, status) => {
  mockAuth.mockResolvedValue(auth)
  mockScope.mockResolvedValue(scope)
  const handler = jest.fn<(ctx: TaskRouteContext) => Promise<Response>>()
  const result = await withTaskRoute(request, ['tasks.view'], handler)
  expect(result.status).toBe(status)
  expect(handler).not.toHaveBeenCalled()
})

it('fails closed when the required feature is denied', async () => {
  mockAllowed.mockResolvedValue(false)
  const handler = jest.fn<(ctx: TaskRouteContext) => Promise<Response>>()
  expect((await withTaskRoute(request, ['tasks.delegate'], handler)).status).toBe(403)
  expect(handler).not.toHaveBeenCalled()
})

it('passes trusted selected scope and wildcard features to the handler', async () => {
  const handler = jest.fn(async (ctx: TaskRouteContext) => {
    expect(ctx.commandContext.selectedOrganizationId).toBe('organization')
    expect(ctx.commandContext.auth!.tenantId).toBe('tenant')
    expect(ctx.userFeatures).toEqual(['tasks.*'])
    return Response.json({ ok: true })
  })
  expect((await withTaskRoute(request, ['tasks.view'], handler)).status).toBe(200)
  expect(mockAllowed).toHaveBeenCalledWith('user', ['tasks.view'], { tenantId: 'tenant', organizationId: 'organization' })
})
