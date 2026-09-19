import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterCommandCommit, isManagedCommandTransaction, runInCommandTransaction } from '@open-mercato/shared/lib/commands'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'docs/development/staff-transaction-patches.json'), 'utf8'))
const require = createRequire(import.meta.url)
for (const entry of manifest.files) {
  const packageRoot = resolve(dirname(require.resolve(entry.package)), '..')
  const actual = createHash('sha256').update(await readFile(resolve(packageRoot, entry.path))).digest('hex')
  assert.equal(actual, entry.sha256, `Installed patch differs: ${entry.package}/${entry.path}`)
}
const fromCore = createRequire(require.resolve('@open-mercato/core'))
assert.equal(fromCore.resolve('@open-mercato/shared/lib/commands'), require.resolve('@open-mercato/shared/lib/commands'), 'Core and app must share one command lifecycle registry')
const effects = []
const context = { container: { resolve(name) {
  assert.equal(name, 'em')
  return { fork: () => ({ transactional: async (work) => {
    effects.push('begin')
    const result = await work({})
    effects.push('commit')
    return result
  } }) }
} } }
await runInCommandTransaction(context, async (managed) => {
  assert.ok(isManagedCommandTransaction(managed))
  await afterCommandCommit(managed, () => { effects.push('effect') })
})
assert.deepEqual(effects, ['begin', 'commit', 'effect'])
console.log(`Verified ${manifest.files.length} installed source/runtime files and compiled transaction lifecycle (${manifest.sourceCommit}).`)
