// Workaround for @open-mercato/enterprise 0.8.0: the generated file-agent manifest in
// .mercato/generated/ keeps the package-relative type imports it has inside the enterprise
// package (`../lib/sdk/outcomeSchema`), which do not resolve from a standalone app and fail
// `tsc`. Rewrite them to package imports after every `mercato generate`. Type-only, no runtime effect.
import fs from 'node:fs'

const file = new URL('../.mercato/generated/file-agents.generated.ts', import.meta.url)
if (!fs.existsSync(file)) process.exit(0)
const base = '@open-mercato/enterprise/modules/agent_orchestrator/lib'
const src = fs.readFileSync(file, 'utf8')
const out = src
  .replace("from '../lib/sdk/outcomeSchema'", `from '${base}/sdk/outcomeSchema'`)
  .replace("from '../lib/tokens/types'", `from '${base}/tokens/types'`)
if (out !== src) fs.writeFileSync(file, out)
