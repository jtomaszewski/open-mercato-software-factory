import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { checkoutPaths, parsePorcelain, isGenerated, protectedPaths, CheckoutError, execCommand, removeCheckout, type CheckoutConfig, type PreparedCheckout, type CollectedChange } from './checkout'

export type RepositorySource = { baseSha: string; files: Array<{ path: string; content: string; executable: boolean }> }

export async function prepareRepositoryCheckout(config: CheckoutConfig, delegationId: string, source: RepositorySource): Promise<PreparedCheckout> {
  if (!/^[a-f0-9]{40}$/.test(source.baseSha)) throw new Error('Invalid repository base SHA')
  for (const file of source.files) {
    if (!file.path || file.path.includes('\\') || file.path.includes('\0') || file.path.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
      throw new Error('Invalid repository source path')
    }
  }
  const paths = checkoutPaths(config, delegationId)
  await removeCheckout(config, delegationId)
  await mkdir(paths.work, { recursive: true })
  await mkdir(paths.gitDir, { recursive: true })
  for (const file of source.files) {
    const path = join(paths.work, file.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(file.content, 'base64'), { mode: file.executable ? 0o755 : 0o644, flag: 'wx' })
  }
  const git = (args: string[]) => execCommand('git', [`--git-dir=${paths.gitDir}`, `--work-tree=${paths.work}`, '-c', 'core.hooksPath=/dev/null', ...args], { cwd: paths.gitDir })
  await git(['init', '--template='])
  await git(['add', '--all', '--force', '--', '.'])
  await git(['-c', 'user.name=Open Mercato', '-c', 'user.email=factory@localhost', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Repository source baseline'])
  await writeFile(join(paths.gitDir, 'repository-base-sha'), source.baseSha, { mode: 0o600 })
  await execCommand('chmod', ['-R', 'a+rwX', paths.work])
  return { baseSha: source.baseSha, workDir: paths.workDir }
}

export async function collectRepositoryChanges(config: CheckoutConfig, delegationId: string): Promise<CollectedChange> {
  // The isolated runtime removes its container before this host-side read begins.
  const paths = checkoutPaths(config, delegationId)
  const git = (args: string[]) => execCommand('git', [`--git-dir=${paths.gitDir}`, `--work-tree=${paths.work}`, '-c', 'core.hooksPath=/dev/null', ...args], { cwd: paths.gitDir })
  const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const changes = parsePorcelain(status.stdout).filter((change) => !isGenerated(change.path))
  if (!changes.length) throw new CheckoutError('The Software Engineer finished without changing any file.', 'no_changes')
  if (protectedPaths(changes.map((change) => change.path)).length) throw new CheckoutError('The agent changed a protected path.', 'protected_path')
  const tree = (await git(['ls-tree', '-r', '-z', 'HEAD'])).stdout
  const modes = new Map(tree.split('\0').filter(Boolean).map((entry) => [entry.slice(entry.indexOf('\t') + 1), entry.slice(0, 6)]))
  const files: CollectedChange['files'] = []
  for (const change of changes) {
    const segments = change.path.split('/')
    if (segments.some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git') || change.path.includes('\\')) throw new CheckoutError('Invalid changed path.', 'protected_path')
    let current = paths.work
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment)
      const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (change.deleted && error.code === 'ENOENT') return null
        throw error
      })
      if (!stat) break
      if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) throw new CheckoutError('The agent produced a symbolic link.', 'protected_path')
      if (index === segments.length - 1 && !change.deleted) {
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new CheckoutError('Unsupported changed file.', 'protected_path')
        const mode = stat.mode & 0o111 ? '100755' : '100644'
        if (mode !== (modes.get(change.path) ?? '100644')) throw new CheckoutError('Executable mode changes are unsupported.', 'protected_path')
      }
    }
    if (change.deleted) { files.push({ path: change.path, content: null }); continue }
    const bytes = await readFile(current)
    let content: string
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch { throw new CheckoutError('Binary changes are unsupported.', 'protected_path') }
    if (content.includes('\0')) throw new CheckoutError('Binary changes are unsupported.', 'protected_path')
    files.push({ path: change.path, content })
  }
  const baseSha = await readFile(join(paths.gitDir, 'repository-base-sha'), 'utf8')
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error('Invalid repository base SHA')
  return { files, baseSha }
}
