import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { Migration20260919101406_tasks } from '../src/modules/tasks/migrations/Migration20260919101406_tasks.ts'

const databaseUrl = process.env.TASKS_TEST_DATABASE_URL
assert.ok(databaseUrl, 'Set TASKS_TEST_DATABASE_URL to the disposable PostgreSQL test database')
const target = new URL(databaseUrl)
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Test database must be loopback')
assert.equal(target.pathname, '/staff_transaction_test', 'Test database name must be staff_transaction_test')
const client = new Client({ connectionString: databaseUrl })
await client.connect()
try {
  await client.query('BEGIN')
  const schema = `tasks_test_${randomUUID().replaceAll('-', '')}`
  await client.query(`CREATE SCHEMA "${schema}"`)
  await client.query(`SET LOCAL search_path TO "${schema}"`)
  const statements = []
  await Migration20260919101406_tasks.prototype.up.call({ addSql: (sql) => statements.push(sql) })
  for (const sql of statements) await client.query(sql)
  const tenantId = randomUUID()
  const organizationId = randomUUID()
  const taskId = randomUUID()
  const projectId = randomUUID()
  const userId = randomUUID()
  const values = [tenantId, organizationId, taskId, projectId, userId]
  const insertDelegation = `INSERT INTO tasks_delegation
    (tenant_id, organization_id, task_id, project_id, delegate_user_id, delegated_by, assignee_user_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $5, $5, now(), now()) RETURNING id`
  const first = await client.query(insertDelegation, values)
  await client.query('SAVEPOINT duplicate_active')
  await assert.rejects(client.query(insertDelegation, values), { code: '23505', constraint: 'tasks_delegation_active_task_uq' })
  await client.query('ROLLBACK TO SAVEPOINT duplicate_active')
  await client.query(insertDelegation, [tenantId, randomUUID(), taskId, projectId, userId])
  await client.query('UPDATE tasks_delegation SET released_at = now() WHERE id = $1', [first.rows[0].id])
  await client.query(insertDelegation, values)
  const processId = randomUUID()
  const receipt = `INSERT INTO tasks_process_write
    (tenant_id, organization_id, task_id, process_instance_id, step_id, command_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'step-one', 'tasks.task.link', now(), now())`
  const receiptValues = [tenantId, organizationId, taskId, processId]
  await client.query(receipt, receiptValues)
  await client.query('SAVEPOINT duplicate_receipt')
  await assert.rejects(client.query(receipt, receiptValues), { code: '23505', constraint: 'tasks_process_write_step_uq' })
  await client.query('ROLLBACK TO SAVEPOINT duplicate_receipt')
  await client.query(receipt, [tenantId, organizationId, taskId, randomUUID()])
  console.log('PASS: migration applies; active delegation and receipt uniqueness; released history; organization and execution isolation')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
