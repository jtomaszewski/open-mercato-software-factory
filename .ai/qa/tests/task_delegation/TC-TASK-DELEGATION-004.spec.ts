import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/testing/integration/api'
import { createOrganizationFixture, createUserFixture } from '@open-mercato/core/testing/integration/authFixtures'
import { Client } from 'pg'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const runFile = promisify(execFile)
type FixtureDatabase = {
  connect(): Promise<void>
  end(): Promise<void>
  query<Row>(sql: string, values: unknown[]): Promise<{ rows: Row[] }>
}
async function withClient<Result>(run: (database: FixtureDatabase) => Promise<Result>): Promise<Result> {
  const database = new Client({ connectionString: process.env.DATABASE_URL }) as FixtureDatabase
  await database.connect()
  try { return await run(database) } finally { await database.end() }
}
type Agent = { userId: string; agentId: string; name: string }
type User = { id: string; name: string; email: string; roleIds: string[]; organizationId: string; tenantId: string; updatedAt: string }
type Principal = { id: string; user_id: string; role_id: string; agent_definition_id: string }
let token: string
let tenantId: string
let organizationId: string | undefined
let client: APIRequestContext
let initialPrincipal: Principal
let existingRoles: string[] = []
let taskId: string
let delegationId: string
let processDefinitionId: string | undefined
let workflowDefinitionId: string | undefined
let processInstanceId: string | undefined
let repositoryId: string

async function seed() {
  await runFile(process.execPath, ['scripts/mercato-cli.mjs', 'task_delegation', 'seed-demo', '--tenant', tenantId, '--org', organizationId!], { env: process.env })
}

async function agents(): Promise<Agent[]> {
  const response = await apiRequest(client, 'GET', '/api/task_delegation/agents', {
    token, headers: { Cookie: `om_selected_org=${organizationId}` },
  })
  expect(response.status()).toBe(200)
  return (await response.json()).items
}

async function readUser(userId: string): Promise<User> {
  const response = await apiRequest(client, 'GET', `/api/auth/users?id=${userId}`, { token })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.items).toHaveLength(1)
  return body.items[0]
}

async function rename(user: User, name: string) {
  return apiRequest(client, 'PUT', '/api/auth/users', {
    token, data: { id: user.id, name }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: user.updatedAt },
  })
}

async function delegation() {
  const response = await apiRequest(client, 'GET', `/api/task_delegation/delegations?taskIds=${taskId}`, {
    token, headers: { Cookie: `om_selected_org=${organizationId}` },
  })
  expect(response.status()).toBe(200)
  return (await response.json()).items[0].delegation
}

async function principals() {
  return withClient(async (database) => (await database.query<Principal>(
    'select id, user_id, role_id, agent_definition_id from agent_principals where tenant_id = $1 and organization_id = $2 and deleted_at is null',
    [tenantId, organizationId],
  )).rows)
}

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(process.env.OM_INTEGRATION_TEST, 'Run through the managed ephemeral CLI').toBe('true')
  const environment = JSON.parse(readFileSync('.ai/qa/ephemeral-env.json', 'utf8'))
  expect(Boolean(process.env.DATABASE_URL) && process.env.DATABASE_URL === environment.databaseUrl, 'Use only the CLI-owned disposable database').toBe(true)
  expect(baseURL).toBe(environment.baseUrl)
  client = await playwright.request.newContext({ baseURL })
  token = await getAuthToken(client, 'superadmin')
  tenantId = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).tenantId
  existingRoles = await withClient(async (database) => (await database.query<{ id: string }>('select id from roles where tenant_id = $1', [tenantId])).rows.map((row) => row.id))
  organizationId = await createOrganizationFixture(client, token, { name: `TEST-010 ${randomUUID()}`, tenantId })
  const humanId = await createUserFixture(client, token, {
    email: `test010-${randomUUID()}@example.invalid`, password: `Test-${randomUUID()}-A1!`,
    name: 'Test operator', organizationId, roles: [],
  })
  await seed()
  const rows = await principals()
  expect(rows).toHaveLength(1)
  initialPrincipal = rows[0]!
  const workflowId = `test010-${randomUUID()}`
  const workflow = await apiRequest(client, 'POST', '/api/workflows/definitions', {
    token, headers: { Cookie: `om_selected_org=${organizationId}` },
    data: {
      workflowId, workflowName: 'TEST-010 local completion', version: 1, enabled: true,
      definition: {
        steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }, { stepId: 'end', stepName: 'End', stepType: 'END' }],
        transitions: [{ transitionId: 'finish', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
      },
    },
  })
  expect(workflow.status()).toBe(201)
  workflowDefinitionId = (await workflow.json()).data.id
  const processResponse = await apiRequest(client, 'POST', '/api/agent_orchestrator/processes', {
    token, headers: { Cookie: `om_selected_org=${organizationId}` },
    data: { name: 'factory.deliver', workflowId, enabled: true, triggers: [{ kind: 'manual', requireFeatures: [] }] },
  })
  expect(processResponse.status()).toBe(201)
  processDefinitionId = (await processResponse.json()).id
  const member = await withClient(async (database) => (await database.query<{ id: string }>('select id from staff_team_members where tenant_id = $1 and organization_id = $2 and user_id = $3 and deleted_at is null', [tenantId, organizationId, humanId])).rows[0]!)
  const project = await withClient(async (database) => (await database.query<{ id: string }>('select id from staff_time_projects where tenant_id = $1 and organization_id = $2 and deleted_at is null', [tenantId, organizationId])).rows[0]!)
  repositoryId = randomUUID()
  await withClient(async (database) => {
    const connectionId = randomUUID()
    await database.query(
      'insert into repositories_connections (id, tenant_id, organization_id, provider, installation_id, broker_authorization_id, account_login, status, connected_by, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())',
      [connectionId, tenantId, organizationId, 'github', '9000000001', randomUUID(), 'integration-fixture', 'active', humanId],
    )
    await database.query(
      'insert into repositories_repositories (id, tenant_id, organization_id, connection_id, github_repository_id, full_name, base_branch, kind, profile, config_epoch, qualification_status, qualification_epoch, status, access_status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 1, $10, 1, $11, $12, now(), now())',
      [repositoryId, tenantId, organizationId, connectionId, '9000000002', 'integration/task-delegation', 'main', 'pr_only', JSON.stringify({ version: 1, commands: { install: 'true', build: 'true', test: 'true' } }), 'passed', 'active', 'granted'],
    )
    await database.query(
      'insert into repositories_project_links (id, tenant_id, organization_id, project_id, repository_id, is_default, created_by, created_at, updated_at) values ($1, $2, $3, $4, $5, true, $6, now(), now())',
      [randomUUID(), tenantId, organizationId, project.id, repositoryId, humanId],
    )
  })
  const response = await apiRequest(client, 'POST', '/api/staff/timesheets/tasks', {
    token, headers: { Cookie: `om_selected_org=${organizationId}` },
    data: { timeProjectId: project.id, title: 'Existing delegated task', assigneeStaffMemberId: member.id },
  })
  expect(response.status()).toBe(201)
  taskId = (await response.json()).id

})

test('Software Engineer keeps the factory identity, operator name and guarded admin update', async () => {
  expect(await agents()).toMatchObject([{ userId: initialPrincipal.user_id, agentId: 'factory', name: 'Software Engineer' }])
  const original = await readUser(initialPrincipal.user_id)
  expect(original.roleIds).toContain(initialPrincipal.role_id)

  expect((await rename(original, 'Factory')).status()).toBe(200)
  await seed()
  const legacy = await readUser(original.id)
  expect(await principals()).toEqual([initialPrincipal])
  expect(legacy.roleIds).toEqual(original.roleIds)
  expect(legacy.name).toBe('Factory')
  expect((await rename(legacy, 'Software Engineer')).status()).toBe(200)
  const stale = await rename(legacy, 'Stale operator edit')
  expect(stale.status()).toBe(409)
  expect(await stale.json()).toMatchObject({ code: 'optimistic_lock_conflict' })
  await seed()
  expect(await agents()).toMatchObject([{ userId: original.id, agentId: 'factory', name: 'Software Engineer' }])
  // Only START -> END runs in this fixture; no provider, GitHub or inference steps exist.
  const delegated = await apiRequest(client, 'POST', '/api/task_delegation/delegations', {
    token, headers: { Cookie: `om_selected_org=${organizationId}` }, data: { taskId, agentUserId: original.id, repositoryId },
  })
  expect(delegated.status()).toBe(201)
  delegationId = (await delegated.json()).delegationId
  await expect.poll(async () => (await delegation())?.processInstanceId).toBeTruthy()
  processInstanceId = (await delegation()).processInstanceId
  await expect.poll(async () => withClient(async (database) => (await database.query<{ status: string }>(
    'select workflow.status from workflow_instances workflow join process_instances execution on execution.workflow_instance_id = workflow.id where execution.id = $1 and execution.tenant_id = $2 and execution.organization_id = $3',
    [processInstanceId, tenantId, organizationId],
  )).rows[0]?.status)).toBe('COMPLETED')

  expect(await delegation()).toMatchObject({ id: delegationId, delegateUserId: original.id, delegateName: 'Software Engineer' })
  const renamed = await readUser(original.id)
  expect((await rename(renamed, 'My engineering agent')).status()).toBe(200)
  await seed()
  expect(await agents()).toMatchObject([{ userId: original.id, agentId: 'factory', name: 'My engineering agent' }])
  expect(await principals()).toEqual([initialPrincipal])
  expect(await delegation()).toMatchObject({ id: delegationId, delegateUserId: original.id, delegateName: 'My engineering agent' })
  const custom = await readUser(original.id)
  expect(custom).toMatchObject({ id: original.id, email: original.email, tenantId: original.tenantId, organizationId: original.organizationId, roleIds: original.roleIds })
})

test.afterAll(async () => {
  try {
    if (!organizationId) return
    const failures: string[] = []
    const remove = async (path: string, id: string) => {
      const response = await apiRequest(client, 'DELETE', path, { token, data: { id }, headers: { Cookie: `om_selected_org=${organizationId}` } })
      if (!response.ok()) failures.push(`${path}: ${response.status()}`)
    }
    await withClient(async (database) => {
      const executions = await database.query<{ id: string; workflow_instance_id: string }>(
        'select id, workflow_instance_id from process_instances where tenant_id = $1 and organization_id = $2 and process_definition_id = $3 and source_entity_id = $4',
        [tenantId, organizationId, processDefinitionId, taskId],
      )
      for (const execution of executions.rows) {
        if (processInstanceId && execution.id !== processInstanceId) failures.push('Unexpected fixture process execution')
        for (const table of ['workflow_events', 'step_instances', 'workflow_branch_instances'] as const) {
          await database.query(`delete from ${table} where tenant_id = $1 and organization_id = $2 and workflow_instance_id = $3`, [tenantId, organizationId, execution.workflow_instance_id])
        }
        await database.query('delete from workflow_instances where tenant_id = $1 and organization_id = $2 and id = $3', [tenantId, organizationId, execution.workflow_instance_id])
        await database.query('delete from process_instances where tenant_id = $1 and organization_id = $2 and id = $3', [tenantId, organizationId, execution.id])
      }
      const remaining = await database.query<{ id: string }>('select id from process_instances where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      if (remaining.rows.length) failures.push('Fixture process executions remain after cleanup')
    })
    if (processDefinitionId) await remove(`/api/agent_orchestrator/processes?id=${processDefinitionId}`, processDefinitionId)
    if (workflowDefinitionId) await remove(`/api/workflows/definitions/${workflowDefinitionId}`, workflowDefinitionId)
    await withClient(async (database) => {
      await database.query('delete from repositories_project_links where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      await database.query('delete from repositories_repositories where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      await database.query('delete from repositories_connections where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      await database.query('delete from task_delegations where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      for (const [table, path] of [
        ['staff_time_tasks', '/api/staff/timesheets/tasks'],
        ['staff_time_projects', '/api/staff/timesheets/time-projects'],
        ['staff_team_members', '/api/staff/team-members'],
        ['customer_entities', '/api/customers/companies'],
        ['users', '/api/auth/users'],
      ] as const) {
        const rows = await database.query<{ id: string }>(`select id from ${table} where tenant_id = $1 and organization_id = $2 and deleted_at is null`, [tenantId, organizationId])
        for (const row of rows.rows) await remove(path, row.id)
      }
      await database.query('delete from staff_time_project_members where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      // The owning API protects the last backlog status, even for a deleted fixture project.
      await database.query('delete from staff_time_task_statuses where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      // Principals have no delete API; remove only this test organization's fixture rows.
      await database.query('delete from agent_principals where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
    })
    if (initialPrincipal && !existingRoles.includes(initialPrincipal.role_id)) await remove('/api/auth/roles', initialPrincipal.role_id)
    await remove('/api/directory/organizations', organizationId)
    expect(failures, 'Fixture cleanup must succeed').toEqual([])
  } finally {
    await client?.dispose()
  }
})
