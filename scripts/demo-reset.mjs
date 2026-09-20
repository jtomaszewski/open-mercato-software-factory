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
// The seeds write through the entity manager, so nothing they create is in the query/search
// index: `catalog.search_products` routes a non-empty query through the search service, and
// scene 2's assistant answered "nie znalazłem produktu ZDP-5000" on a freshly reset demo.
// The organization logo needs it too — core's update command emits a query-index event with the
// wrong scope, which is rejected. One full rebuild covers both (~6 s for the whole demo).
mercato('query_index', 'reindex', '--all', '--force')

console.log(`[demo:reset] done — tenant ${rows[0].tenant_id}, org ${rows[0].id}; login superadmin@acme.com / secret`)
console.log('[demo:reset] GitHub is untouched: close leftover Developer PRs/branches on the landing repo yourself.')

// A reset wipes our record of the GitHub App installation (connection, repository, project link).
// The installation itself survives on GitHub's side — reconnecting is one consent click — but
// until it is back, scenes 3 and 3b put their task on the board and the coding run dies at
// checkout, which is a confusing way to discover a missing setup step five minutes before a pitch.
const verify = new pg.Client({ connectionString: databaseUrl })
await verify.connect()
const { rows: links } = await verify.query(
  `select r.full_name from repositories_project_links l
     join repositories_repositories r on r.id = l.repository_id
     join staff_time_projects p on p.id = l.project_id
    where p.code = $1 and r.deleted_at is null`,
  // Keep in step with DEMO_PROJECT_CODE in src/modules/task_delegation/lib/demoSetup.ts.
  ['WWW'],
)
await verify.end()
if (links.length) {
  console.log(`[demo:reset] WWW repository: ${links.map((row) => row.full_name).join(', ')}`)
} else {
  const origin = process.env.APP_URL || `http://localhost:${process.env.PORT || process.env.CONDUCTOR_PORT || 3000}`
  console.warn('[demo:reset] ⚠ no repository is linked to the WWW project — scenes 3 and 3b will')
  console.warn('[demo:reset]   create their board task and then fail at checkout.')
  console.warn(`[demo:reset]   Reconnect: ${origin}/backend/code/repositories → Repository settings`)
  console.warn('[demo:reset]   → Connect GitHub, register the landing repo, link it to WWW.')
  console.warn(`[demo:reset]   The GitHub App must list ${origin}/backend/repositories/connect as a`)
  console.warn('[demo:reset]   callback URL, or the consent redirect lands nowhere.')
}
