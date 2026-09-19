import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/testing/integration/api'
import { Client } from 'pg'

test('registry isolates scopes and guards disable/delete with the stored version', async ({ request, baseURL }) => {
  expect(process.env.OM_INTEGRATION_TEST).toBe('true')
  const environment = JSON.parse(readFileSync('.ai/qa/ephemeral-env.json', 'utf8'))
  expect(process.env.DATABASE_URL).toBe(environment.databaseUrl)
  expect(baseURL).toBe(environment.baseUrl)
  const token = await getAuthToken(request, 'superadmin')
  const identity = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
  const tenantId = identity.tenantId
  const organizationId = identity.orgId ?? identity.organizationId
  expect(organizationId).toBeTruthy()
  const connectionId = randomUUID()
  const repositoryId = randomUUID()
  const foreignRepositoryId = randomUUID()
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  const headers = { Cookie: `om_selected_org=${organizationId}` }
  try {
    await database.query('insert into repositories_connections (id,tenant_id,organization_id,installation_id,broker_authorization_id,account_login,connected_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,now(),now())',
      [connectionId, tenantId, organizationId, String(Date.now()), randomUUID(), 'integration-fixture', identity.sub])
    for (const [id, scope] of [[repositoryId, organizationId], [foreignRepositoryId, randomUUID()]]) {
      await database.query('insert into repositories_repositories (id,tenant_id,organization_id,connection_id,github_repository_id,full_name,base_branch,kind,profile,qualification_status,qualification_epoch,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())',
        [id, tenantId, scope, connectionId, id.replaceAll('-', '').slice(0, 20), `integration/${id}`, 'main', 'pr_only', JSON.stringify({ commands: { install: 'true', build: 'true', test: 'true' } }), 'passed', 1])
    }
    const detail = await apiRequest(request, 'GET', `/api/repositories/${repositoryId}`, { token, headers })
    expect(detail.status()).toBe(200)
    const original = await detail.json()
    expect(original).toMatchObject({ id: repositoryId, status: 'active', qualificationStatus: 'passed' })
    expect((await apiRequest(request, 'GET', `/api/repositories/${foreignRepositoryId}`, { token, headers })).status()).toBe(404)
    const list = await apiRequest(request, 'GET', '/api/repositories?search=integration/', { token, headers })
    expect(list.status()).toBe(200)
    expect((await list.json()).items.map((item: { id: string }) => item.id)).toEqual([repositoryId])
    const removeActive = await apiRequest(request, 'DELETE', `/api/repositories/${repositoryId}`, { token, headers, data: { updatedAt: original.updatedAt } })
    expect(removeActive.status()).toBe(409)
    const disabled = await apiRequest(request, 'POST', `/api/repositories/${repositoryId}/disable`, { token, headers, data: { updatedAt: original.updatedAt } })
    expect(disabled.status()).toBe(200)
    const stale = await apiRequest(request, 'POST', `/api/repositories/${repositoryId}/disable`, { token, headers, data: { updatedAt: original.updatedAt } })
    expect(stale.status()).toBe(409)
    const current = await (await apiRequest(request, 'GET', `/api/repositories/${repositoryId}`, { token, headers })).json()
    expect(current.status).toBe('disabled')
    expect((await apiRequest(request, 'DELETE', `/api/repositories/${repositoryId}`, { token, headers, data: { updatedAt: current.updatedAt } })).status()).toBe(200)
    expect((await apiRequest(request, 'GET', `/api/repositories/${repositoryId}`, { token, headers })).status()).toBe(404)
  } finally {
    await database.query('delete from repositories_event_intents where payload->>\'repositoryId\' = any($1::text[])', [[repositoryId, foreignRepositoryId]])
    await database.query('delete from repositories_repositories where id = any($1::uuid[])', [[repositoryId, foreignRepositoryId]])
    await database.query('delete from repositories_connections where id = $1', [connectionId])
    await database.end()
  }
})
