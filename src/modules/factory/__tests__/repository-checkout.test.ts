import { expect, test } from '@jest/globals'
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareRepositoryCheckout, collectRepositoryChanges } from '../lib/repository-checkout'
import type { CheckoutConfig } from '../lib/checkout'

test('broker source becomes a credential-free workspace and changes retain the real base SHA', async () => {
  const root = await mkdtemp(join(tmpdir(), 'om-registry-checkout-'))
  const config: CheckoutConfig = { repo: 'owner/authorized', baseBranch: 'main', workspaceRoot: join(root, 'work'), containerWorkspaceRoot: '/work', gitRoot: join(root, 'git') }
  const baseSha = 'a'.repeat(40)
  try {
    const checkout = await prepareRepositoryCheckout(config, 'delegation-1', {
      baseSha, files: [{ path: 'src/index.ts', content: Buffer.from('original\n').toString('base64'), executable: false }],
    })
    expect(checkout).toEqual({ baseSha, workDir: '/work/factory/delegation-1' })
    await expect(readFile(join(root, 'work/factory/delegation-1/.git'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(join(root, 'work/factory/delegation-1/src/index.ts'), 'changed\n')
    await expect(collectRepositoryChanges(config, 'delegation-1')).resolves.toEqual({ baseSha, files: [{ path: 'src/index.ts', content: 'changed\n' }] })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('broker source rejects traversal before writing outside the checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'om-registry-checkout-'))
  const config: CheckoutConfig = { repo: 'owner/authorized', baseBranch: 'main', workspaceRoot: join(root, 'work'), containerWorkspaceRoot: '/work', gitRoot: join(root, 'git') }
  try {
    await expect(prepareRepositoryCheckout(config, 'delegation-1', {
      baseSha: 'a'.repeat(40), files: [{ path: '../escaped', content: 'eA==', executable: false }],
    })).rejects.toThrow('Invalid repository source path')
  } finally { await rm(root, { recursive: true, force: true }) }
})


test.each(['binary', 'symlink-parent', 'executable-mode'])('rejects unsupported %s changes before PR publication', async (kind) => {
  const root = await mkdtemp(join(tmpdir(), 'om-registry-checkout-'))
  const config: CheckoutConfig = { repo: 'owner/authorized', baseBranch: 'main', workspaceRoot: join(root, 'work'), containerWorkspaceRoot: '/work', gitRoot: join(root, 'git') }
  const work = join(root, 'work/factory/delegation-1')
  try {
    await prepareRepositoryCheckout(config, 'delegation-1', {
      baseSha: 'a'.repeat(40), files: [{ path: 'src/index.ts', content: Buffer.from('original\n').toString('base64'), executable: false }],
    })
    if (kind === 'binary') await writeFile(join(work, 'src/index.ts'), Buffer.from([0xff, 0x80, 0x00]))
    if (kind === 'executable-mode') await chmod(join(work, 'src/index.ts'), 0o755)
    if (kind === 'symlink-parent') {
      await mkdir(join(root, 'private'))
      await writeFile(join(root, 'private/index.ts'), 'host-private')
      await rm(join(work, 'src'), { recursive: true })
      await symlink(join(root, 'private'), join(work, 'src'))
    }
    await expect(collectRepositoryChanges(config, 'delegation-1')).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
