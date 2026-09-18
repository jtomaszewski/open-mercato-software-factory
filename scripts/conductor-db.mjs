// Admin DB helper for the Conductor per-worktree database workflow.
//
// Each worktree gets its OWN Postgres database, CLONED from a project-level template DB
// (`CREATE DATABASE <worktree> TEMPLATE <project>`) so it starts already migrated + seeded —
// no per-worktree `yarn initialize` reseed. This script runs the maintenance-level SQL that
// `yarn db:migrate` / `yarn initialize` can't (create/clone/drop a database).
//
// Run it with cwd = the repo root so `pg` and ./dev-database-url.mjs resolve:
//   ( node scripts/conductor-db.mjs <cmd> [args] )
//
// Connection creds/host/port come from .env DATABASE_URL; only the database
// name is swapped (to the `postgres` maintenance DB for create/clone/drop/exists).
//
// Commands:
//   exists <db>           -> prints "yes" / "no"
//   create <db>           -> CREATE DATABASE <db>            (no-op if it exists)
//   clone  <src> <dst>    -> CREATE DATABASE <dst> TEMPLATE <src>  (no-op if <dst> exists)
//   drop   <db>           -> DROP DATABASE IF EXISTS <db>
//   user-count <db>       -> prints the row count of the `users` table (0 if unseeded)
import fs from 'node:fs'
import pg from 'pg'
import { readEnvDatabaseUrl, rewriteDatabaseUrl, validateDatabaseName } from './dev-database-url.mjs'

const ENV_FILE = process.env.CONDUCTOR_ENV_FILE || '.env'

function baseUrl() {
  const url = readEnvDatabaseUrl(fs.readFileSync(ENV_FILE, 'utf8'))
  if (!url) {
    console.error(`[conductor-db] DATABASE_URL missing from ${ENV_FILE}`)
    process.exit(1)
  }
  return url
}

function assertName(name) {
  const check = validateDatabaseName(name)
  if (!check.ok) {
    console.error(`[conductor-db] invalid database name "${name}": ${check.reason}`)
    process.exit(1)
  }
  // Identifiers can't be parameterized; names are validated to [a-z0-9_] so quoting is safe.
  return `"${name}"`
}

async function withClient(dbName, fn) {
  const client = new pg.Client({ connectionString: rewriteDatabaseUrl(baseUrl(), dbName) })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    try { await client.end() } catch {}
  }
}

async function dbExists(name) {
  return withClient('postgres', async (c) => {
    const res = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    return res.rowCount > 0
  })
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  switch (cmd) {
    case 'exists': {
      process.stdout.write((await dbExists(rest[0])) ? 'yes' : 'no')
      break
    }
    case 'create': {
      const q = assertName(rest[0])
      if (await dbExists(rest[0])) break
      await withClient('postgres', (c) => c.query(`CREATE DATABASE ${q}`))
      break
    }
    case 'clone': {
      const [src, dst] = rest
      const srcQ = assertName(src)
      const dstQ = assertName(dst)
      if (await dbExists(dst)) break
      if (!(await dbExists(src))) {
        console.error(`[conductor-db] template database "${src}" does not exist`)
        process.exit(1)
      }
      // CREATE DATABASE ... TEMPLATE requires no other sessions on the source.
      await withClient('postgres', (c) => c.query(`CREATE DATABASE ${dstQ} TEMPLATE ${srcQ}`))
      break
    }
    case 'drop': {
      const q = assertName(rest[0])
      await withClient('postgres', (c) => c.query(`DROP DATABASE IF EXISTS ${q}`))
      break
    }
    case 'user-count': {
      assertName(rest[0])
      const n = await withClient(rest[0], async (c) => {
        try {
          const res = await c.query('SELECT count(*)::int AS n FROM users')
          return res.rows[0].n
        } catch (err) {
          if (err && err.code === '42P01') return 0 // users table absent -> unseeded
          throw err
        }
      })
      process.stdout.write(String(n))
      break
    }
    default:
      console.error(`[conductor-db] unknown command: ${cmd ?? '(none)'}`)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(`[conductor-db] ${err.message}`)
  process.exit(1)
})
