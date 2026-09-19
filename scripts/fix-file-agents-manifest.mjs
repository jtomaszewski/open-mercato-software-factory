// Workarounds for @open-mercato 0.8.0's file-agent generator, applied after every `mercato generate`.
//
// 1. The generated manifest in .mercato/generated/ keeps the package-relative type imports it has
//    inside the enterprise package (`../lib/sdk/outcomeSchema`), which do not resolve from a
//    standalone app and fail `tsc`. Rewrite them to package imports. Type-only, no runtime effect.
// 2. The CLI renders every OpenCode agent file with `write/edit/bash: deny`, while the enterprise
//    SDK (`defineFileAgent`) honours `files: true` / `filesBash: true` in AGENT.md with the file-plane
//    frontmatter. Re-render that frontmatter for such agents so the sidecar lets them edit (and, with
//    `filesBash`, run commands) inside the shared sandbox root, exactly as the SDK would. The result
//    goes to docker/opencode/agents-local/, which docker-compose mounts over the generated file:
//    `yarn dev` regenerates docker/opencode/agents/ on its own (without this script), so a patch in
//    place would not survive.
import fs from 'node:fs'
import path from 'node:path'

const root = new URL('..', import.meta.url)
const manifest = new URL('.mercato/generated/file-agents.generated.ts', root)
if (fs.existsSync(manifest)) {
  const base = '@open-mercato/enterprise/modules/agent_orchestrator/lib'
  const src = fs.readFileSync(manifest, 'utf8')
  const out = src
    .replace("from '../lib/sdk/outcomeSchema'", `from '${base}/sdk/outcomeSchema'`)
    .replace("from '../lib/tokens/types'", `from '${base}/tokens/types'`)
  if (out !== src) fs.writeFileSync(manifest, out)
}

const modulesDir = new URL('src/modules/', root)
const agentsOut = new URL('docker/opencode/agents/', root)
const agentsLocal = new URL('docker/opencode/agents-local/', root)
const workspaceRoot = (process.env.OM_OPENCODE_WORKSPACE_ROOT_CONTAINER || '/home/opencode/work').trim()
const truthy = new Set(['true', '1', 'yes', 'on'])

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  return match ? match[1] : null
}

function readFlag(block, key) {
  const line = block.split('\n').find((entry) => entry.startsWith(`${key}:`))
  return line ? truthy.has(line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '').toLowerCase()) : false
}

for (const moduleId of fs.existsSync(modulesDir) ? fs.readdirSync(modulesDir) : []) {
  const agentsDir = new URL(`${moduleId}/agents/`, modulesDir)
  if (!fs.existsSync(agentsDir)) continue
  for (const agentDir of fs.readdirSync(agentsDir)) {
    const agentMd = new URL(`${agentDir}/AGENT.md`, agentsDir)
    if (!fs.existsSync(agentMd)) continue
    const meta = frontmatter(fs.readFileSync(agentMd, 'utf8'))
    if (!meta || !readFlag(meta, 'files')) continue
    const id = meta.split('\n').find((line) => line.startsWith('id:'))?.slice(3).trim()
    if (!id) continue
    const fileName = `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`
    const generated = new URL(fileName, agentsOut)
    if (!fs.existsSync(generated)) continue
    const rendered = fs.readFileSync(generated, 'utf8')
    const bash = readFlag(meta, 'filesBash')
    const glob = JSON.stringify(`${workspaceRoot}/**`)
    const scoped = (tool) => `  ${tool}:\n    ${glob}: allow\n    "*": deny`
    const patched = rendered
      .replace(/\npermission:\n  write: deny\n  edit: deny\n  bash: deny\n/, () =>
        `\n  read: true\n  write: true\n  edit: true${bash ? '\n  bash: true' : ''}\npermission:\n${['write', 'edit', 'read'].map(scoped).join('\n')}\n  bash: ${bash ? 'allow' : 'deny'}\n`)
    fs.mkdirSync(agentsLocal, { recursive: true })
    fs.writeFileSync(new URL(fileName, agentsLocal), patched)
    console.log(`[fix-file-agents] ${id}: file-plane frontmatter written to ${path.relative(process.cwd(), agentsLocal.pathname)}/${fileName}`)
  }
}
