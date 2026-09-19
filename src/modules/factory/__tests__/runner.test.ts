import { beforeEach, describe, expect, it } from '@jest/globals'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  agentError, isGenerated, lastAgentText, parsePorcelain, protectedPaths, readRunnerConfigFromEnv, runDeveloperAgent,
  type Exec, type RunnerConfig,
} from '../lib/runner'

const config: RunnerConfig = { image: 'img', model: 'anthropic/x', timeoutMs: 1000, repo: 'o/site', baseBranch: 'main', modelEnv: { ANTHROPIC_API_KEY: 'sk-ant-secret-value' } }

describe('runner helpers', () => {
  it('parses porcelain output, renames as delete + add', () => {
    const out = [' M app/page.tsx', '?? app/produkty/zwm-1500/page.tsx', ' D old.ts', 'R  new.ts', 'was.ts'].join('\0') + '\0'
    expect(parsePorcelain(out)).toEqual([
      { path: 'app/page.tsx', deleted: false },
      { path: 'app/produkty/zwm-1500/page.tsx', deleted: false },
      { path: 'old.ts', deleted: true },
      { path: 'was.ts', deleted: true },
      { path: 'new.ts', deleted: false },
    ])
  })

  it('flags protected and generated paths', () => {
    expect(protectedPaths(['.github/workflows/site.yml', 'vercel.json', '.env.local', 'app/page.tsx'])).toEqual(['.github/workflows/site.yml', 'vercel.json', '.env.local'])
    expect(['node_modules/x/index.js', '.next/cache', 'out/index.html', 'app/out.ts'].map(isGenerated)).toEqual([true, true, true, false])
  })

  it('reads the agent summary and its error events', () => {
    const events = [
      '{"type":"text","part":{"type":"text","text":"Czytam AGENTS.md"}}',
      'not json',
      '{"type":"text","part":{"type":"text","text":"Dodałem stronę ZWM-1500."}}',
    ].join('\n')
    expect(lastAgentText(events)).toBe('Dodałem stronę ZWM-1500.')
    expect(agentError(events)).toBeNull()
    expect(agentError('{"type":"error","error":{"name":"APIError","data":{"message":"API key is invalid."}}}')).toBe('API key is invalid.')
  })

  it('needs a model key and keeps the GitHub token out of the container env', () => {
    expect(() => readRunnerConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow('No model API key')
    const read = readRunnerConfigFromEnv({ ANTHROPIC_API_KEY: 'a', FACTORY_GITHUB_TOKEN: 'secret' } as unknown as NodeJS.ProcessEnv)
    expect(read.modelEnv).toEqual({ ANTHROPIC_API_KEY: 'a' })
    expect(read.model).toBe('anthropic/claude-sonnet-4-5')
  })

  it('defaults to Claude through OpenRouter when only an OpenRouter key is set', () => {
    const read = readRunnerConfigFromEnv({ FACTORY_RUNNER_OPENROUTER_API_KEY: 'or' } as unknown as NodeJS.ProcessEnv)
    expect(read.modelEnv).toEqual({ OPENROUTER_API_KEY: 'or' })
    expect(read.model).toBe('openrouter/anthropic/claude-sonnet-4.5')
    expect(readRunnerConfigFromEnv({ OPENROUTER_API_KEY: 'or', FACTORY_RUNNER_MODEL: 'openrouter/x/y' } as unknown as NodeJS.ProcessEnv).model).toBe('openrouter/x/y')
  })
})

describe('runDeveloperAgent', () => {
  let calls: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[]
  let agentWrites: (work: string) => Promise<void>
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
    if (command === 'docker' && args[0] === 'run') {
      const mount = args[args.indexOf('-v') + 1]!.split(':')[0]!
      await agentWrites(mount)
      return { stdout: '{"type":"text","part":{"type":"text","text":"Gotowe."}}\n', stderr: '' }
    }
    if (command === 'git' && args.includes('status')) return { stdout: porcelain, stderr: '' }
    return { stdout: '', stderr: '' }
  }

  beforeEach(() => {
    calls = []
    porcelain = '?? app/new.tsx\0?? node_modules/pkg/index.js\0'
    agentWrites = async (work) => {
      await mkdir(join(work, 'app'), { recursive: true })
      await writeFile(join(work, 'app/new.tsx'), 'export default 1\n')
    }
  })

  it('returns the changed source files on the cloned base, never build output', async () => {
    const result = await runDeveloperAgent(config, { runId: 'task-1', prompt: 'do it' }, exec)
    expect(result).toMatchObject({ baseSha: 'base-sha', summary: 'Gotowe.', files: [{ path: 'app/new.tsx', content: 'export default 1\n' }] })
    const docker = calls.find((call) => call.command === 'docker' && call.args[0] === 'run')!
    expect(docker.args).toEqual(expect.arrayContaining(['-e', 'ANTHROPIC_API_KEY', 'img', 'run', '--format', 'json', '-m', 'anthropic/x', 'do it']))
    expect(docker.args.join(' ')).not.toContain('sk-ant-secret-value')
    expect(docker.env?.ANTHROPIC_API_KEY).toBe('sk-ant-secret-value')
    // `.git` is not in the mounted work tree; host git uses a separate git dir.
    expect(calls.filter((call) => call.command === 'git' && call.args[0] !== 'clone').every((call) => call.args.some((arg) => arg.startsWith('--git-dir=')))).toBe(true)
  })

  it('refuses a protected path, an empty change and a symlink out of the checkout', async () => {
    porcelain = ' M .github/workflows/site.yml\0'
    await expect(runDeveloperAgent(config, { runId: 'r', prompt: 'p' }, exec)).rejects.toMatchObject({ reason: 'protected_path' })
    porcelain = '?? node_modules/a.js\0'
    await expect(runDeveloperAgent(config, { runId: 'r', prompt: 'p' }, exec)).rejects.toMatchObject({ reason: 'no_changes' })
    porcelain = '?? leak.txt\0'
    agentWrites = async (work) => { await symlink('/etc/hosts', join(work, 'leak.txt')) }
    await expect(runDeveloperAgent(config, { runId: 'r', prompt: 'p' }, exec)).rejects.toMatchObject({ reason: 'protected_path' })
  })

  it('reports a timeout and an agent error with its reason', async () => {
    const timingOut: Exec = async (command, args, options) => {
      if (command === 'docker' && args[0] === 'run') throw Object.assign(new Error('killed'), { killed: true })
      return exec(command, args, options)
    }
    await expect(runDeveloperAgent(config, { runId: 'r', prompt: 'p' }, timingOut)).rejects.toMatchObject({ reason: 'timeout' })
    const erroring: Exec = async (command, args, options) => {
      if (command === 'docker' && args[0] === 'run') return { stdout: '{"type":"error","error":{"data":{"message":"API key is invalid."}}}\n', stderr: '' }
      return exec(command, args, options)
    }
    await expect(runDeveloperAgent(config, { runId: 'r', prompt: 'p' }, erroring)).rejects.toThrow('API key is invalid.')
  })
})
