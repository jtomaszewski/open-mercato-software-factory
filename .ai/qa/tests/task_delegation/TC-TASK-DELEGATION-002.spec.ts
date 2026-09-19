import { test, expect } from '@playwright/test'

test('assignment endpoints require authentication', async ({ playwright, baseURL }) => {
  const client = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const taskId = '20000000-0000-4000-8000-000000000001'
    const responses = [
      await client.post('/api/task_delegation/assignments', { data: { taskId, assigneeStaffMemberId: '20000000-0000-4000-8000-000000000003' } }),
      await client.get(`/api/task_delegation/assignable-people?taskId=${taskId}`),
    ]
    for (const response of responses) {
      expect(response.status(), response.url()).toBe(401)
    }
  } finally {
    await client.dispose()
  }
})
