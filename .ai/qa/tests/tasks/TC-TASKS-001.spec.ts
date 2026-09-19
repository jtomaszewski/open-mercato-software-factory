import { test, expect } from '@playwright/test'

test('delegation endpoints require authentication', async ({ playwright, baseURL }) => {
  const client = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const taskId = '20000000-0000-4000-8000-000000000001'
    const responses = [
      await client.get(`/api/tasks/delegations?taskIds=${taskId}`),
      await client.get('/api/tasks/agents'),
      await client.post('/api/tasks/delegations', { data: { taskId, agentUserId: '20000000-0000-4000-8000-000000000002' } }),
      await client.delete(`/api/tasks/delegations/${taskId}`),
    ]
    for (const response of responses) {
      expect(response.status(), response.url()).toBe(401)
    }
  } finally {
    await client.dispose()
  }
})
