import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, posix, relative } from 'node:path'

const root = process.argv[2]
const generatedDirectories = new Set([
  'node_modules',
  '.next',
  '.mercato',
  'out',
  '.turbo',
  'test-results',
  'playwright-report',
])
const maxFiles = 5_000
const maxFileBytes = 1024 * 1024
const maxBytes = 32 * 1024 * 1024

if (!root) throw new Error('source root is required')

const files = []
const pending = [root]
let bytes = 0

while (pending.length > 0) {
  const directory = pending.pop()
  const names = await readdir(directory)
  for (const name of names) {
    const absolute = join(directory, name)
    const path = relative(root, absolute).split('\\').join('/')
    if (!path || posix.isAbsolute(path) || posix.normalize(path) !== path || path.startsWith('../')) {
      throw new Error('invalid source path')
    }
    const entry = await lstat(absolute)
    if (entry.isSymbolicLink()) throw new Error('source contains a symbolic link')
    if (entry.isDirectory()) {
      if (name === '.git') throw new Error('source contains a protected directory')
      if (!generatedDirectories.has(name)) pending.push(absolute)
      continue
    }
    if (!entry.isFile()) throw new Error('source contains an unsupported entry')
    if (entry.size > maxFileBytes) throw new Error('source file exceeds the export limit')
    files.push({ path, executable: Boolean(entry.mode & 0o111), contentBase64: (await readFile(absolute)).toString('base64') })
    if (files.length > maxFiles) throw new Error('source exceeds the file-count limit')
    bytes += entry.size
    if (bytes > maxBytes) throw new Error('source exceeds the byte limit')
  }
}

process.stdout.write(JSON.stringify({ files }))
