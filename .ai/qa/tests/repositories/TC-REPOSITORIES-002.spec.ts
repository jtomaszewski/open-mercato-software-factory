import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/testing/integration/api'
import { Client } from 'pg'

test('project links select one/default targets and reject stale link changes', async ({ request, baseURL }) => {
  expect(process.env.OM_INTEGRATION_TEST).toBe('true')
  const environment = JSON.parse(readFileSync('.ai/qa/ephemeral-env.json', 'utf8'))
  expect(process.env.DATABASE_URL).toBe(environment.databaseUrl)
  expect(baseURL).toBe(environment.baseUrl)
  const token = await getAuthToken(request, 'superadmin')
  const identity = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
  const tenantId = identity.tenantId
  const organizationId = identity.orgId ?? identity.organizationId
  expect(organizationId).toBeTruthy()
  const projectId = randomUUID()
  const connectionId = randomUUID()
  const repositoryIds = [randomUUID(), randomUUID()]
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  const headers = { Cookie: `om_selected_org=${organizationId}` }
  try {
    await database.query(
      'insert into staff_time_projects (id, tenant_id, organization_id, name, code, created_at, updated_at) values ($1, $2, $3, $4, $5, now(), now())',
      [projectId, tenantId, organizationId, 'Repository link fixture', `R${randomUUID().slice(0, 7)}`],
    )
    await database.query(
      'insert into repositories_connections (id, tenant_id, organization_id, installation_id, broker_authorization_id, account_login, connected_by, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, now(), now())',
      [connectionId, tenantId, organizationId, '9100000001', randomUUID(), 'project-link-fixture', identity.sub],
    )
    for (const [index, repositoryId] of repositoryIds.entries()) {
      await database.query(
        'insert into repositories_repositories (id, tenant_id, organization_id, connection_id, github_repository_id, full_name, base_branch, kind, profile, qualification_status, qualification_epoch, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 1, now(), now())',
        [repositoryId, tenantId, organizationId, connectionId, `910000000${index + 2}`, `integration/project-${index + 1}`, 'main', 'pr_only', JSON.stringify({ version: 1, commands: { install: 'true', build: 'true', test: 'true' } }), 'passed'],
      )
    }

    const empty = await apiRequest(request, 'GET', `/api/repositories/for-project?projectId=${projectId}`, { token, headers })
    expect(empty.status()).toBe(200)
    expect((await empty.json()).items).toEqual([])

    const first = await apiRequest(request, 'POST', '/api/repositories/project-links', {
      token, headers, data: { projectId, repositoryId: repositoryIds[0], isDefault: true },
    })
    expect(first.status()).toBe(200)
    const second = await apiRequest(request, 'POST', '/api/repositories/project-links', {
      token, headers, data: { projectId, repositoryId: repositoryIds[1], isDefault: true },
    })
    expect(second.status()).toBe(200)
    const secondLink = await second.json()

    const linked = await apiRequest(request, 'GET', `/api/repositories/for-project?projectId=${projectId}`, { token, headers })
    expect(linked.status()).toBe(200)
    expect((await linked.json()).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: repositoryIds[0], usable: true, isDefault: false }),
      expect.objectContaining({ id: repositoryIds[1], usable: true, isDefault: true }),
    ]))

    const linksAfterSecondDefault = await (await apiRequest(request, 'GET', `/api/repositories/project-links?projectId=${projectId}`, { token, headers })).json()
    const firstAfterDemotion = linksAfterSecondDefault.items.find((item: { repositoryId: string }) => item.repositoryId === repositoryIds[0])
    const makeFirstDefault = await apiRequest(request, 'POST', '/api/repositories/project-links', {
      token, headers, data: { projectId, repositoryId: repositoryIds[0], isDefault: true, updatedAt: firstAfterDemotion.updatedAt },
    })
    expect(makeFirstDefault.status()).toBe(200)
    const stale = await apiRequest(request, 'POST', '/api/repositories/project-links', {
      token, headers, data: { projectId, repositoryId: repositoryIds[0], isDefault: false, updatedAt: firstAfterDemotion.updatedAt },
    })
    expect(stale.status()).toBe(409)

    const refreshedLinks = await (await apiRequest(request, 'GET', `/api/repositories/project-links?projectId=${projectId}`, { token, headers })).json()
    const refreshedSecond = refreshedLinks.items.find((item: { repositoryId: string }) => item.repositoryId === repositoryIds[1])
    expect(refreshedSecond.updatedAt).not.toBe(secondLink.updatedAt)
    const remove = await apiRequest(request, 'DELETE', '/api/repositories/project-links', {
      token, headers, data: { projectId, repositoryId: repositoryIds[1], updatedAt: refreshedSecond.updatedAt },
    })
    expect(remove.status()).toBe(200)
  } finally {
    await database.query('delete from repositories_event_intents where tenant_id = $1 and organization_id = $2 and payload->>\'projectId\' = $3', [tenantId, organizationId, projectId])
    await database.query('delete from repositories_project_links where tenant_id = $1 and organization_id = $2 and project_id = $3', [tenantId, organizationId, projectId])
    await database.query('delete from repositories_repositories where id = any($1::uuid[])', [repositoryIds])
    await database.query('delete from repositories_connections where id = $1', [connectionId])
    await database.query('delete from staff_time_projects where id = $1 and tenant_id = $2 and organization_id = $3', [projectId, tenantId, organizationId])
    await database.end()
  }
})
