import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkoutPaths, collectChanges, isGenerated, parsePorcelain, prepareCheckout, protectedPaths, readCheckoutConfigFromEnv, toChangedFile, type CheckoutConfig, type Exec,
} from '../lib/checkout'

describe('checkout helpers', () => {
  it('parses porcelain output, renames as delete + add', () => {
    expect(parsePorcelain(' M a.ts\0?? b.ts\0D  c.ts\0R  new.ts\0old.ts\0')).toEqual([
      { path: 'a.ts', deleted: false }, { path: 'b.ts', deleted: false }, { path: 'c.ts', deleted: true },
      { path: 'old.ts', deleted: true }, { path: 'new.ts', deleted: false },
    ])
  })

  it('flags protected and generated paths', () => {
    expect(protectedPaths(['app/x.tsx', '.github/workflows/site.yml', 'vercel.json', '.env.local'])).toEqual(['.github/workflows/site.yml', 'vercel.json', '.env.local'])
    expect(['node_modules/a.js', '.next/x', 'app/a.tsx'].map(isGenerated)).toEqual([true, true, false])
  })

  it('keeps text (SVG included) as UTF-8 and commits images as base64', () => {
    expect(toChangedFile('public/logos/a.svg', Buffer.from('<svg>ż</svg>'))).toEqual({ path: 'public/logos/a.svg', content: '<svg>ż</svg>' })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])
    expect(toChangedFile('public/logos/a.png', png)).toEqual({ path: 'public/logos/a.png', content: png.toString('base64'), encoding: 'base64' })
  })

  it('puts the checkout under the sandbox root and its git dir outside it', () => {
    const config = readCheckoutConfigFromEnv({ OM_OPENCODE_WORKSPACE_ROOT: './.mercato/opencode-work' } as unknown as NodeJS.ProcessEnv, '/app')
    expect(config).toMatchObject({ workspaceRoot: '/app/.mercato/opencode-work', containerWorkspaceRoot: '/home/opencode/work', gitRoot: '/app/.mercato/factory-git' })
    expect(checkoutPaths(config, 'task-1')).toEqual({
      work: '/app/.mercato/opencode-work/factory/task-1', gitDir: '/app/.mercato/factory-git/task-1', workDir: '/home/opencode/work/factory/task-1',
    })
    expect(() => checkoutPaths(config, '../x')).toThrow('Refusing')
    expect(() => readCheckoutConfigFromEnv({ FACTORY_SITE_REPO: 'nope' } as unknown as NodeJS.ProcessEnv)).toThrow('owner/name')
  })
})

describe('prepareCheckout + collectChanges', () => {
  let root: string
  let config: CheckoutConfig
  let calls: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[]
  let porcelain: string

  const exec: Exec = async (command, args, options) => {
    calls.push({ command, args, env: options?.env })
    if (command === 'git' && args[0] === 'clone') {
      const work = args[args.length - 1]!
      await mkdir(work, { recursive: true })
      await writeFile(join(work, 'AGENTS.md'), 'rules')
      await writeFile(join(work, '.git'), 'gitdir: elsewhere')
      return { stdout: '', stderr: '' }
    }
    if (command === 'git' && args.includes('rev-parse')) return { stdout: 'base-sha\n', stderr: '' }
    if (command === 'git' && args.includes('status')) return { stdout: porcelain, stderr: '' }
    return { stdout: '', stderr: '' }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'om-checkout-'))
    config = { repo: 'o/site', baseBranch: 'main', workspaceRoot: join(root, 'work'), containerWorkspaceRoot: '/home/opencode/work', gitRoot: join(root, 'git') }
    calls = []
    porcelain = '?? app/new.tsx\0?? node_modules/pkg/index.js\0'
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('clones into the sandbox, keeps .git out of it, and reads the changed source files back', async () => {
    const prepared = await prepareCheckout(config, 'task-1', exec)
    expect(prepared).toEqual({ baseSha: 'base-sha', workDir: '/home/opencode/work/factory/task-1' })
    const clone = calls.find((call) => call.args[0] === 'clone')!
    expect(clone.args).toEqual(expect.arrayContaining([`--separate-git-dir=${join(root, 'git/task-1')}`, 'https://github.com/o/site.git', join(root, 'work/factory/task-1')]))
    // `.git` is not in the work tree; host git uses the separate git dir.
    expect(calls.filter((call) => call.command === 'git' && call.args[0] !== 'clone').every((call) => call.args.some((arg) => arg.startsWith('--git-dir=')))).toBe(true)

    await mkdir(join(root, 'work/factory/task-1/app'), { recursive: true })
    await writeFile(join(root, 'work/factory/task-1/app/new.tsx'), 'export default 1\n')
    await expect(collectChanges(config, 'task-1', exec)).resolves.toEqual({ baseSha: 'base-sha', files: [{ path: 'app/new.tsx', content: 'export default 1\n' }] })
  })

  it('refuses a protected path, an empty change and a symlink out of the checkout', async () => {
    await prepareCheckout(config, 'task-1', exec)
    porcelain = ' M .github/workflows/site.yml\0'
    await expect(collectChanges(config, 'task-1', exec)).rejects.toMatchObject({ reason: 'protected_path' })
    porcelain = '?? node_modules/a.js\0'
    await expect(collectChanges(config, 'task-1', exec)).rejects.toMatchObject({ reason: 'no_changes' })
    porcelain = '?? leak.txt\0'
    await symlink('/etc/hosts', join(root, 'work/factory/task-1/leak.txt'))
    await expect(collectChanges(config, 'task-1', exec)).rejects.toMatchObject({ reason: 'protected_path' })
  })

  it('clones a private repo with the token in git env config, never on the command line', async () => {
    await prepareCheckout(config, 'task-1', exec, 'ghs_secret')
    const clone = calls.find((call) => call.args[0] === 'clone')!
    expect(clone.args.join(' ')).not.toContain('ghs_secret')
    expect(clone.args).toContain('https://github.com/o/site.git')
    expect(clone.env).toMatchObject({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from('x-access-token:ghs_secret').toString('base64')}`,
    })
    // Only the clone talks to GitHub; later git calls get no credentials.
    expect(calls.filter((call) => call.args[0] !== 'clone').every((call) => call.env === undefined)).toBe(true)
  })

  it('reports a clone failure as a setup error', async () => {
    const failing: Exec = async (command, args) => {
      if (args[0] === 'clone') throw new Error('network')
      return exec(command, args)
    }
    await expect(prepareCheckout(config, 'task-1', failing)).rejects.toMatchObject({ reason: 'setup' })
  })
})
