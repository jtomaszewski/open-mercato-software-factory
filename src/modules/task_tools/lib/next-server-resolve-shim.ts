/**
 * Workaround for a platform gap in the standalone MCP server (`yarn mercato
 * ai_assistant mcp:serve-http`, which `yarn dev` also runs), open-mercato 0.8.0.
 *
 * `createAiApiOperationRunner` loads route modules from `@open-mercato/core/dist`
 * with a native ESM `import()`. Several `staff` routes this module needs
 * (`time-projects`, `tasks/{id}/comments`) start with `import { NextResponse } from
 * "next/server"`. `next` ships no `exports` map, so Node's ESM resolver cannot
 * resolve the extensionless subpath outside the Next bundler and the route fails
 * with "Cannot find module .../node_modules/next/server". Inside the Next app the
 * bundler resolves it and this shim is not installed.
 *
 * The shim maps exactly that one specifier to `next/server.js` with a synchronous
 * in-thread resolve hook. It changes nothing else and is idempotent. Remove it once
 * the platform resolves route modules itself.
 */
import * as nodeModule from 'node:module'

type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context?: unknown) => unknown,
) => unknown

type RegisterHooks = (hooks: { resolve: ResolveHook }) => unknown

let installed = false

export function nextServerSpecifier(specifier: string): string {
  return specifier === 'next/server' ? 'next/server.js' : specifier
}

export function installNextServerResolveShim(): boolean {
  if (installed) return true
  // The Next runtime bundles route modules itself; only plain Node needs the hook.
  if (process.env.NEXT_RUNTIME) return false
  const registerHooks = (nodeModule as unknown as { registerHooks?: RegisterHooks }).registerHooks
  if (typeof registerHooks !== 'function') return false
  registerHooks({
    resolve: (specifier, context, nextResolve) => nextResolve(nextServerSpecifier(specifier), context),
  })
  installed = true
  return true
}
