import { execFile } from 'node:child_process'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The Developer agent runner (execution spec EX-P0): a checkout on the host, the agent in a
 * disposable `om-developer-runner` container with only the model key, and the changed files read
 * back on the host. The host, not the container, later commits and opens the PR.
 */

export type RunnerConfig = {
  image: string
  model: string
  timeoutMs: number
  /** `owner/name` of the public site repo; cloned without credentials. */
  repo: string
  baseBranch: string
  /** Env passed into the container: the model key only. */
  modelEnv: Record<string, string>
}

export type ChangedFile = { path: string; content: string | null }

export type RunnerResult = {
  baseSha: string
  files: ChangedFile[]
  /** The agent's closing message, for the PR body. */
  summary: string
  durationMs: number
}

export class RunnerError extends Error {
  constructor(message: string, readonly reason: 'timeout' | 'agent_failed' | 'no_changes' | 'protected_path' | 'setup') {
    super(message)
    this.name = 'RunnerError'
  }
}

const MODEL_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'] as const

/**
 * OpenCode `provider/model` for the key that is set. OpenRouter ids use its own naming
 * (`anthropic/claude-sonnet-4.5`, with a dot).
 */
function defaultModel(modelEnv: Record<string, string>): string {
  if (modelEnv.ANTHROPIC_API_KEY) return 'anthropic/claude-sonnet-4-5'
  if (modelEnv.OPENROUTER_API_KEY) return 'openrouter/anthropic/claude-sonnet-4.5'
  return 'openai/gpt-5'
}

export function readRunnerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const modelEnv: Record<string, string> = {}
  for (const key of MODEL_KEYS) {
    const value = env[`FACTORY_RUNNER_${key}`]?.trim() || env[key]?.trim()
    if (value) modelEnv[key] = value
  }
  if (Object.keys(modelEnv).length === 0) {
    throw new RunnerError('No model API key is set (FACTORY_RUNNER_ANTHROPIC_API_KEY, FACTORY_RUNNER_OPENROUTER_API_KEY or FACTORY_RUNNER_OPENAI_API_KEY); the Developer agent cannot run.', 'setup')
  }
  const repo = env.FACTORY_SITE_REPO?.trim() || 'jtomaszewski/hackaton-stal-zbiorniki-landing'
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new RunnerError(`FACTORY_SITE_REPO must be owner/name, got "${repo}"`, 'setup')
  return {
    image: env.FACTORY_RUNNER_IMAGE?.trim() || 'om-developer-runner:local',
    model: env.FACTORY_RUNNER_MODEL?.trim() || defaultModel(modelEnv),
    timeoutMs: Number(env.FACTORY_RUNNER_TIMEOUT_MS) > 0 ? Number(env.FACTORY_RUNNER_TIMEOUT_MS) : 15 * 60_000,
    repo,
    baseBranch: env.FACTORY_SITE_BASE_BRANCH?.trim() || 'main',
    modelEnv,
  }
}

/** Paths the agent must never change (execution spec: protected factory/CI/provider controls). */
const PROTECTED = [/^\.github\//, /^\.git\//, /^vercel\.json$/, /^\.vercel\//, /^\.env/]

export function protectedPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => PROTECTED.some((pattern) => pattern.test(path)))
}

/** `git status --porcelain=v1 -z` → changed paths, renames as delete + add. */
export function parsePorcelain(output: string): { path: string; deleted: boolean }[] {
  const entries = output.split('\0').filter(Boolean)
  const result: { path: string; deleted: boolean }[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    if (status.startsWith('R') || status.startsWith('C')) {
      const source = entries[++index]
      if (status.startsWith('R') && source) result.push({ path: source, deleted: true })
      result.push({ path, deleted: false })
      continue
    }
    result.push({ path, deleted: status.includes('D') })
  }
  return result
}

export type Exec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>

export const execCommand: Exec = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      const failure = error as Error & { killed?: boolean; stdout?: string; stderr?: string }
      failure.stdout = String(stdout)
      failure.stderr = String(stderr)
      reject(failure)
      return
    }
    resolve({ stdout: String(stdout), stderr: String(stderr) })
  })
})

/** Build output and dependencies the agent's `npm ci`/build leave behind; never published. */
const GENERATED = [/^node_modules\//, /^\.next\//, /^out\//, /^\.turbo\//, /^test-results\//, /^playwright-report\//]

export function isGenerated(path: string): boolean {
  return GENERATED.some((pattern) => pattern.test(path))
}

/** The first error OpenCode reported (`{"type":"error",...}` events), or null. */
export function agentError(jsonEvents: string): string | null {
  for (const line of jsonEvents.split('\n')) {
    if (!line.includes('"error"')) continue
    try {
      const event = JSON.parse(line) as { type?: string; error?: { name?: string; message?: string; data?: { message?: string } } }
      if (event.type === 'error') return event.error?.data?.message ?? event.error?.message ?? event.error?.name ?? 'unknown error'
    } catch {
      // Not every line is an event.
    }
  }
  return null
}

/** The last text the agent wrote, from `opencode run --format json` events. */
export function lastAgentText(jsonEvents: string): string {
  let text = ''
  for (const line of jsonEvents.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    try {
      const event = JSON.parse(line) as { type?: string; part?: { type?: string; text?: string } }
      if (event.part?.type === 'text' && typeof event.part.text === 'string' && event.part.text.trim()) text = event.part.text.trim()
    } catch {
      // Not every line is an event.
    }
  }
  return text
}

export async function runDeveloperAgent(
  config: RunnerConfig,
  input: { runId: string; prompt: string },
  exec: Exec = execCommand,
): Promise<RunnerResult> {
  const started = Date.now()
  const root = await mkdtemp(join(tmpdir(), 'om-developer-'))
  // Only the work tree is mounted. `.git` stays on the host side, so nothing the agent writes can
  // become a git hook or config that host-side git would execute.
  const work = join(root, 'work')
  const gitDir = join(root, 'git')
  const git = (args: string[]) => exec('git', [`--git-dir=${gitDir}`, `--work-tree=${work}`, ...args], { cwd: root })
  const name = `om-developer-${input.runId.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40)}`
  try {
    await exec('git', ['clone', '--depth', '1', '--branch', config.baseBranch, `--separate-git-dir=${gitDir}`, `https://github.com/${config.repo}.git`, work], { timeoutMs: 120_000 })
      .catch((error: Error) => { throw new RunnerError(`Cannot clone ${config.repo}: ${error.message}`, 'setup') })
    await rm(join(work, '.git'), { force: true })
    const baseSha = (await git(['rev-parse', 'HEAD'])).stdout.trim()
    // The container's `node` user (uid 1000) must be able to write the checkout.
    await exec('chmod', ['-R', 'a+rwX', work])

    let stdout = ''
    try {
      const result = await exec('docker', [
        'run', '--rm', '--name', name,
        '--cpus', '2', '--memory', '4g', '--pids-limit', '512',
        '-v', `${work}:/work`, '-w', '/work',
        // `-e KEY` without a value copies it from this process env: the key never lands in argv.
        ...Object.keys(config.modelEnv).flatMap((key) => ['-e', key]),
        config.image,
        'run', '--format', 'json', '-m', config.model, input.prompt,
      ], { timeoutMs: config.timeoutMs, cwd: root, env: { ...process.env, ...config.modelEnv } })
        .catch((error: Error & { killed?: boolean; stdout?: string; stderr?: string }) => {
          if (error.killed) throw new RunnerError(`The Developer agent did not finish within ${Math.round(config.timeoutMs / 60_000)} minutes.`, 'timeout')
          const reason = agentError(error.stdout ?? '') ?? (error.stderr || error.message).slice(-2000)
          throw new RunnerError(`The Developer agent failed: ${reason}`, 'agent_failed')
        })
      stdout = result.stdout
      const reported = agentError(stdout)
      if (reported) throw new RunnerError(`The Developer agent failed: ${reported}`, 'agent_failed')
    } finally {
      await exec('docker', ['rm', '-f', name]).catch(() => undefined)
    }

    const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    const changes = parsePorcelain(status.stdout).filter((change) => !isGenerated(change.path))
    if (changes.length === 0) throw new RunnerError('The Developer agent finished without changing any file.', 'no_changes')
    const blocked = protectedPaths(changes.map((change) => change.path))
    if (blocked.length) throw new RunnerError(`The Developer agent changed protected paths: ${blocked.join(', ')}`, 'protected_path')

    const files: ChangedFile[] = []
    for (const change of changes) {
      if (change.deleted) {
        files.push({ path: change.path, content: null })
        continue
      }
      const absolute = resolve(work, change.path)
      // A symlink or `..` path would make the host read a file outside the checkout into the PR.
      if (!absolute.startsWith(`${work}/`) || (await lstat(absolute)).isSymbolicLink()) {
        throw new RunnerError(`The Developer agent produced a link or path outside the repository: ${change.path}`, 'protected_path')
      }
      files.push({ path: change.path, content: await readFile(absolute, 'utf8') })
    }
    return { baseSha, files, summary: lastAgentText(stdout), durationMs: Date.now() - started }
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}
