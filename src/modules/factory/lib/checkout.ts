import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * The website checkout the Developer agent works on. It lives under the orchestrator's OpenCode
 * sandbox root (the one bind-mounted into the sidecar), at `factory/<taskId>`, so the file agent
 * may edit and build it there; `.git` stays outside the sandbox on the host, so nothing the agent
 * writes can become a hook or config that host-side git would execute. After the run the host
 * reads the changed files back and opens the PR; the checkout is then removed.
 */

export type CheckoutConfig = {
  /** `owner/name` of the public site repo; cloned without credentials. */
  repo: string
  baseBranch: string
  /** Host path of the sandbox root (`OM_OPENCODE_WORKSPACE_ROOT`). */
  workspaceRoot: string
  /** The same root as the sidecar sees it (`OM_OPENCODE_WORKSPACE_ROOT_CONTAINER`). */
  containerWorkspaceRoot: string
  /** Host directory for the checkouts' git dirs, outside the sandbox. */
  gitRoot: string
}

/** `content: null` is a deletion; binary files (images) travel base64-encoded. */
export type ChangedFile = { path: string; content: string | null; encoding?: 'utf-8' | 'base64' }

/** Text is valid UTF-8 without NUL bytes; anything else is committed as a binary blob. */
export function toChangedFile(path: string, bytes: Buffer): ChangedFile {
  const text = bytes.toString('utf8')
  const binary = bytes.includes(0) || !Buffer.from(text, 'utf8').equals(bytes)
  return binary ? { path, content: bytes.toString('base64'), encoding: 'base64' } : { path, content: text }
}

export type PreparedCheckout = { baseSha: string; workDir: string }

export type CollectedChange = { baseSha: string; files: ChangedFile[] }

export class CheckoutError extends Error {
  constructor(message: string, readonly reason: 'no_changes' | 'protected_path' | 'setup') {
    super(message)
    this.name = 'CheckoutError'
  }
}

export function readCheckoutConfigFromEnv(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): CheckoutConfig {
  const repo = env.FACTORY_SITE_REPO?.trim() || 'jtomaszewski/hackaton-stal-zbiorniki-landing'
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new CheckoutError(`FACTORY_SITE_REPO must be owner/name, got "${repo}"`, 'setup')
  const workspaceRoot = env.OM_OPENCODE_WORKSPACE_ROOT?.trim() || './.mercato/opencode-work'
  return {
    repo,
    baseBranch: env.FACTORY_SITE_BASE_BRANCH?.trim() || 'main',
    workspaceRoot: isAbsolute(workspaceRoot) ? workspaceRoot : resolve(cwd, workspaceRoot),
    containerWorkspaceRoot: (env.OM_OPENCODE_WORKSPACE_ROOT_CONTAINER?.trim() || '/home/opencode/work').replace(/\/$/, ''),
    gitRoot: resolve(cwd, env.FACTORY_CHECKOUT_GIT_ROOT?.trim() || './.mercato/factory-git'),
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

/** Build output and dependencies the agent's `npm ci`/build leave behind; never published. */
const GENERATED = [/^node_modules\//, /^\.next\//, /^out\//, /^\.turbo\//, /^test-results\//, /^playwright-report\//]

export function isGenerated(path: string): boolean {
  return GENERATED.some((pattern) => pattern.test(path))
}

export type Exec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>

export const execCommand: Exec = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
  execFile(command, args, { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      const failure = error as Error & { stdout?: string; stderr?: string }
      failure.stdout = String(stdout)
      failure.stderr = String(stderr)
      reject(failure)
      return
    }
    resolvePromise({ stdout: String(stdout), stderr: String(stderr) })
  })
})

function safeTaskId(taskId: string): string {
  const id = taskId.replace(/[^a-zA-Z0-9_.-]/g, '')
  if (!id || id !== taskId) throw new CheckoutError(`Refusing to use "${taskId}" as a checkout name`, 'setup')
  return id
}

export function checkoutPaths(config: CheckoutConfig, taskId: string): { work: string; gitDir: string; workDir: string } {
  const id = safeTaskId(taskId)
  return {
    work: join(config.workspaceRoot, 'factory', id),
    gitDir: join(config.gitRoot, id),
    workDir: `${config.containerWorkspaceRoot}/factory/${id}`,
  }
}

function gitFor(exec: Exec, paths: { work: string; gitDir: string }) {
  return (args: string[]) => exec('git', [`--git-dir=${paths.gitDir}`, `--work-tree=${paths.work}`, ...args], { cwd: paths.gitDir })
}

/** Fresh clone of the base branch for the task; a stale checkout of the same task is replaced. */
export async function prepareCheckout(config: CheckoutConfig, taskId: string, exec: Exec = execCommand): Promise<PreparedCheckout> {
  const paths = checkoutPaths(config, taskId)
  await removeCheckout(config, taskId)
  await mkdir(join(config.workspaceRoot, 'factory'), { recursive: true })
  await mkdir(config.gitRoot, { recursive: true })
  await exec('git', ['clone', '--depth', '1', '--branch', config.baseBranch, `--separate-git-dir=${paths.gitDir}`, `https://github.com/${config.repo}.git`, paths.work], { timeoutMs: 120_000 })
    .catch((error: Error) => { throw new CheckoutError(`Cannot clone ${config.repo}: ${error.message}`, 'setup') })
  // The clone leaves a `.git` pointer file in the work tree; without it the agent sees no repository.
  await rm(join(paths.work, '.git'), { force: true })
  const baseSha = (await gitFor(exec, paths)(['rev-parse', 'HEAD'])).stdout.trim()
  // The sidecar's `opencode` user (uid 1000) must be able to write the checkout.
  await exec('chmod', ['-R', 'a+rwX', paths.work])
  return { baseSha, workDir: paths.workDir }
}

/** The agent's changes as files to commit: source only, never build output, links or protected paths. */
export async function collectChanges(config: CheckoutConfig, taskId: string, exec: Exec = execCommand): Promise<CollectedChange> {
  const paths = checkoutPaths(config, taskId)
  const git = gitFor(exec, paths)
  const baseSha = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const changes = parsePorcelain(status.stdout).filter((change) => !isGenerated(change.path))
  if (changes.length === 0) throw new CheckoutError('The Developer agent finished without changing any file.', 'no_changes')
  const blocked = protectedPaths(changes.map((change) => change.path))
  if (blocked.length) throw new CheckoutError(`The Developer agent changed protected paths: ${blocked.join(', ')}`, 'protected_path')

  const files: ChangedFile[] = []
  for (const change of changes) {
    if (change.deleted) {
      files.push({ path: change.path, content: null })
      continue
    }
    const absolute = resolve(paths.work, change.path)
    // A symlink or `..` path would make the host read a file outside the checkout into the PR.
    if (!absolute.startsWith(`${paths.work}/`) || (await lstat(absolute)).isSymbolicLink()) {
      throw new CheckoutError(`The Developer agent produced a link or path outside the repository: ${change.path}`, 'protected_path')
    }
    files.push(toChangedFile(change.path, await readFile(absolute)))
  }
  return { baseSha, files }
}

export async function removeCheckout(config: CheckoutConfig, taskId: string): Promise<void> {
  const paths = checkoutPaths(config, taskId)
  await rm(paths.work, { recursive: true, force: true })
  await rm(paths.gitDir, { recursive: true, force: true })
}
