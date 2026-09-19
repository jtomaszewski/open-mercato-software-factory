import { describe, expect, it } from '@jest/globals'
import {
  TaskToolError,
  boardHref,
  createStaffApi,
  projectCodeFromReference,
  toTaskToolError,
} from '../lib/staff-api'
import { requireToolScope } from '../lib/scope'
import { nextServerSpecifier } from '../lib/next-server-resolve-shim'
import { PROJECT_OPS, PROJECT_WEB, createFakeStaff, taskRow } from '../__fixtures__/fake-staff'

describe('requireToolScope', () => {
  it('returns the context scope', () => {
    expect(requireToolScope({ tenantId: 't', organizationId: 'o', userId: 'u' })).toEqual({
      tenantId: 't',
      organizationId: 'o',
      userId: 'u',
    })
  })

  it.each([
    { tenantId: null, organizationId: 'o', userId: 'u' },
    { tenantId: 't', organizationId: null, userId: 'u' },
    { tenantId: 't', organizationId: '  ', userId: 'u' },
    { tenantId: 't', organizationId: 'o', userId: null },
  ])('fails closed on missing scope %#', (context) => {
    expect(() => requireToolScope(context)).toThrow('[internal]')
  })
})

describe('staff api helpers', () => {
  it('derives the project code from a reference, including codes with dashes', () => {
    expect(projectCodeFromReference('WEB-13')).toBe('WEB')
    expect(projectCodeFromReference('ACME-WEB-7')).toBe('ACME-WEB')
    expect(projectCodeFromReference(null)).toBeNull()
    expect(projectCodeFromReference('nodash')).toBeNull()
  })

  it('builds the board drawer deep link, absolute when the app URL is known', () => {
    expect(boardHref('p1', 't1')).toBe('/backend/staff/time-tracking/projects/p1/board?task=t1')
    expect(boardHref('p1', 't1', 'http://localhost:3000/')).toBe(
      'http://localhost:3000/backend/staff/time-tracking/projects/p1/board?task=t1',
    )
  })

  it('maps route failures to machine-readable codes carried in the message', () => {
    const error = toTaskToolError({
      success: false,
      statusCode: 422,
      error: 'Staff member not found',
      details: { fieldErrors: { assigneeStaffMemberId: 'x' } },
    })
    expect(error).toBeInstanceOf(TaskToolError)
    expect(error.code).toBe('validation_failed')
    expect(JSON.parse(error.message)).toEqual({
      code: 'validation_failed',
      message: 'Staff member not found',
      status: 422,
      details: { fieldErrors: { assigneeStaffMemberId: 'x' } },
    })
    expect(toTaskToolError({ success: false, statusCode: 403 }).code).toBe('forbidden')
    expect(toTaskToolError({ success: false, statusCode: 500 }).code).toBe('staff_api_error')
  })

  it('maps only the bare next/server specifier', () => {
    expect(nextServerSpecifier('next/server')).toBe('next/server.js')
    expect(nextServerSpecifier('next/server.js')).toBe('next/server.js')
    expect(nextServerSpecifier('next/headers')).toBe('next/headers')
  })
})

describe('createStaffApi.resolveProject', () => {
  it('resolves a code exactly, then case-insensitively', async () => {
    const { runner } = createFakeStaff({ projects: [PROJECT_WEB, PROJECT_OPS] })
    const api = createStaffApi(runner)
    await expect(api.resolveProject('WEB')).resolves.toMatchObject({ id: PROJECT_WEB.id, code: 'WEB' })
    await expect(api.resolveProject('ops')).resolves.toMatchObject({ id: PROJECT_OPS.id })
  })

  it('resolves an id through the ids filter', async () => {
    const { runner, requests } = createFakeStaff()
    const api = createStaffApi(runner)
    await expect(api.resolveProject(PROJECT_WEB.id)).resolves.toMatchObject({ code: 'WEB' })
    expect(requests[0].query).toMatchObject({ ids: PROJECT_WEB.id })
  })

  it('answers project_not_found for unknown codes and for ids the route hides (404)', async () => {
    const { runner } = createFakeStaff()
    const api = createStaffApi(runner)
    await expect(api.resolveProject('NOPE')).rejects.toMatchObject({ code: 'project_not_found' })
    await expect(api.resolveProject(PROJECT_OPS.id)).rejects.toMatchObject({ code: 'project_not_found' })
  })

  it('refuses an ambiguous case-insensitive match', async () => {
    const { runner } = createFakeStaff({
      projects: [
        { ...PROJECT_WEB, code: 'Web' },
        { ...PROJECT_OPS, code: 'WEb' },
      ],
    })
    await expect(createStaffApi(runner).resolveProject('web')).rejects.toMatchObject({ code: 'project_not_found' })
  })
})

describe('createStaffApi.findTask', () => {
  it('narrows the route prefix match to the exact reference', async () => {
    const { runner } = createFakeStaff({
      tasks: [taskRow({ id: 'a', reference: 'WEB-10' }), taskRow({ id: 'b', reference: 'WEB-1' })],
    })
    const task = await createStaffApi(runner).findTask({ reference: 'web-1' })
    expect(task?.id).toBe('b')
  })

  it('returns null when the route does not return the task (missing or not visible)', async () => {
    const { runner } = createFakeStaff({ tasks: [] })
    await expect(createStaffApi(runner).findTask({ reference: 'WEB-1' })).resolves.toBeNull()
    await expect(createStaffApi(runner).findTaskByRef('55555555-5555-4555-8555-555555555555')).resolves.toBeNull()
  })

  it('rejects an id whose reference does not match', async () => {
    const { runner } = createFakeStaff()
    const api = createStaffApi(runner)
    await expect(
      api.findTask({ taskId: '55555555-5555-4555-8555-555555555555', reference: 'WEB-2' }),
    ).resolves.toBeNull()
  })
})

describe('createStaffApi comments', () => {
  it('turns a hidden task into task_not_found on comment create', async () => {
    const { runner } = createFakeStaff({ tasks: [] })
    await expect(createStaffApi(runner).createComment('missing', 'hi')).rejects.toMatchObject({
      code: 'task_not_found',
    })
  })

  it('returns null for the thread of a hidden task', async () => {
    const { runner } = createFakeStaff({ tasks: [] })
    await expect(createStaffApi(runner).listComments('missing', 50)).resolves.toBeNull()
  })
})
