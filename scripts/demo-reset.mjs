#!/usr/bin/env node
// Resets the database in .env DATABASE_URL to the clean hackathon demo state (SPEC-004):
// wipe + init without the core example content, then our demo seeds. Destructive.
// Stop `yarn dev` (and its queue worker) first; restart it afterwards.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { readEnvDatabaseUrl } from './dev-database-url.mjs'

function mercato(...args) {
  const result = spawnSync('yarn', ['mercato', ...args], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`[demo:reset] \`yarn mercato ${args.join(' ')}\` failed`)
    process.exit(result.status ?? 1)
  }
}

const databaseUrl = process.env.DATABASE_URL || readEnvDatabaseUrl(fs.readFileSync('.env', 'utf8'))
if (!databaseUrl) {
  console.error('[demo:reset] DATABASE_URL missing from the environment and .env')
  process.exit(1)
}
console.log(`[demo:reset] resetting ${new URL(databaseUrl).pathname.slice(1)} on ${new URL(databaseUrl).host}`)

// Plain `init --reinstall` would also seed the core examples (fashion products, services).
mercato('init', '--reinstall', '--no-examples', '--org=Metal Zbiorniki')

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
const { rows } = await client.query(
  'select id, tenant_id from organizations where deleted_at is null order by created_at limit 1',
)
await client.end()
if (!rows[0]) {
  console.error('[demo:reset] init created no organization')
  process.exit(1)
}
const scope = ['--tenant', rows[0].tenant_id, '--org', rows[0].id]

mercato('demo_fixtures', 'seed-metal-zbiorniki', ...scope)
mercato('task_delegation', 'seed-demo', ...scope)
mercato('website_publishing', 'ensure-process', ...scope)
// The seed sets the organization logo through core's update command, whose query-index event
// carries the wrong scope and is rejected; rebuild that one index so it matches the record.
mercato('query_index', 'reindex', '--entity', 'directory:organization', '--force')

console.log(`[demo:reset] done — tenant ${rows[0].tenant_id}, org ${rows[0].id}; login superadmin@acme.com / secret`)
console.log('[demo:reset] GitHub is untouched: close leftover Developer PRs/branches on the landing repo yourself.')
