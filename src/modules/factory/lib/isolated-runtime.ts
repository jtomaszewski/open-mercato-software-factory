import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { asValue, type AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AgentResult } from '@open-mercato/enterprise/modules/agent_orchestrator/data/validators'
import {
  AgentRuntimeService,
  type AgentRunCtx,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentRuntime'
import {
  AgentWorkspaceManager,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentWorkspaceManager'
import type { AgentRunSessionStore } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentRunSessionStore'
import { createOpenCodeClient } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/opencode-client'
import {
  CheckoutError,
  checkoutPaths,
  isGenerated,
  type ChangedFile,
  type CheckoutConfig,
} from './checkout'
import { collectRepositoryChanges } from './repository-checkout'
import { DEVELOPER_AGENT_ID } from './developer'
import type { RepositoryTargetResolver, ResolvedRepositoryTarget } from '../../repositories/lib/target-resolver'

const factoryInputSchema = z.object({ delegationId: z.string().uuid() }).passthrough()
const CONTAINER_CHECKOUT_PATH = '/workspace/repository'
const CONTAINER_ARTIFACT_PATH = '/workspace/artifacts'
const CONTAINER_CONFIG_PATH = '/home/opencode/.config/opencode/opencode.json'
const FACTORY_EXPORT_BYTES = 32 * 1024 * 1024
const FACTORY_EXPORT_FILE_BYTES = 1024 * 1024
const FACTORY_EXPORT_FILES = 5_000
const FACTORY_EXPORT_BUFFER_BYTES = 48 * 1024 * 1024

export type FactoryRunGatewayAccess = {
  providerBaseUrl: string
  providerApiKey: string
  model: string
  mcpUrl: string
  mcpHeaders: Record<string, string>
  authorizeSessionToken(token: string): void
  close(): Promise<void>
}

export type FactoryContainerStartInput = {
  delegationId: string
  checkoutPath: string
  artifactPath: string
  controlPath: string
  checkoutConfig: CheckoutConfig
  gateway: FactoryRunGatewayAccess
}

export type FactoryContainerHandle = {
  baseUrl: string
  password: string
  complete(): Promise<void>
  stop(): Promise<void>
}

export type FactoryContainerSupervisor = {
  start(input: FactoryContainerStartInput): Promise<FactoryContainerHandle>
}

export type DockerCommandResult = { ok: boolean; stdout: string; stderr: string }
export type DockerCommand = (args: string[], timeoutMs?: number, maxBufferBytes?: number) => Promise<DockerCommandResult>

type DockerFactoryContainerSupervisorDeps = {
  image: string | (() => string)
  command?: DockerCommand
  healthcheck?: (input: { baseUrl: string; password: string }) => Promise<void>
  captureSnapshot?: (name: string, input: FactoryContainerStartInput) => Promise<() => Promise<void>>
  user?: string
}

export class FactoryRuntimeCleanupError extends Error {
  readonly code = 'factory_runtime_cleanup_unverified'

  constructor(errors: unknown[]) {
    super(`[internal] isolated factory runtime cleanup failed: ${errors.map(errorMessage).join('; ')}`)
    this.name = 'FactoryRuntimeCleanupError'
  }
}

export class DockerFactoryContainerSupervisor implements FactoryContainerSupervisor {
  private readonly image: string | (() => string)
  private readonly command: DockerCommand
  private readonly healthcheck: (input: { baseUrl: string; password: string }) => Promise<void>
  private readonly captureSnapshot: (name: string, input: FactoryContainerStartInput) => Promise<() => Promise<void>>
  private readonly user: string

  constructor(deps: DockerFactoryContainerSupervisorDeps) {
    this.image = deps.image
    this.command = deps.command ?? runDockerCommand
    this.healthcheck = deps.healthcheck ?? waitForOpenCode
    this.captureSnapshot = deps.captureSnapshot ?? ((name, input) => captureFactorySnapshot(this.command, name, input))
    this.user = deps.user ?? '1000:1000'
  }

  async start(input: FactoryContainerStartInput): Promise<FactoryContainerHandle> {
    const image = typeof this.image === 'function' ? this.image() : this.image
    if (!image.trim()) throw new Error('[internal] FACTORY_DEVELOPER_RUNNER_IMAGE is required')
    const name = `om-factory-${input.delegationId}`
    const keeperName = `${name}-keeper`
    const volumeName = `${name}-work`
    const password = randomBytes(32).toString('base64url')
    const configPath = join(input.controlPath, 'opencode.json')
    await mkdir(input.controlPath, { recursive: true, mode: 0o700 })
    await writeFile(configPath, `${JSON.stringify(openCodeConfig(input.gateway), null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o444,
    })

    const existingVolume = await this.command(['volume', 'inspect', volumeName], 10_000)
    if (existingVolume.ok) throw new Error('[internal] isolated factory work volume already exists')

    let volumeCreated = false
    let keeperStarted = false
    let executionStarted = false
    let stopped = false

    const removeContainer = async (containerName: string): Promise<unknown | null> => {
      const removed = await this.command(['rm', '--force', containerName], 30_000)
      const listed = await this.command(['ps', '--all', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}'], 10_000)
      if (!listed.ok || listed.stdout.split('\n').some((line) => line.trim() === containerName)) {
        return new Error(removed.ok ? `container ${containerName} remains present` : boundedOutput(removed.stderr))
      }
      return null
    }

    const removeVolume = async (): Promise<unknown | null> => {
      const removed = await this.command(['volume', 'rm', volumeName], 30_000)
      const listed = await this.command([
        'volume', 'ls', '--filter', `name=^${volumeName}$`, '--format', '{{.Name}}',
      ], 10_000)
      if (!listed.ok) return new Error(`could not verify volume removal: ${boundedOutput(listed.stderr)}`)
      if (listed.stdout.split('\n').some((line) => line.trim() === volumeName)) {
        return new Error(removed.ok ? `volume ${volumeName} remains present` : boundedOutput(removed.stderr))
      }
      return null
    }

    const cleanup = async (): Promise<unknown[]> => {
      if (stopped) return []
      const errors: unknown[] = []
      if (executionStarted) {
        const error = await removeContainer(name)
        if (error) errors.push(error)
        else executionStarted = false
      }
      if (keeperStarted) {
        const error = await removeContainer(keeperName)
        if (error) errors.push(error)
        else keeperStarted = false
      }
      if (volumeCreated && !executionStarted && !keeperStarted) {
        const error = await removeVolume()
        if (error) errors.push(error)
        else volumeCreated = false
      }
      if (errors.length === 0) stopped = true
      return errors
    }

    const stop = async (): Promise<void> => {
      const errors = await cleanup()
      if (errors.length > 0) throw new FactoryRuntimeCleanupError(errors)
    }

    const complete = async (): Promise<void> => {
      const executionError = executionStarted ? await removeContainer(name) : null
      if (!executionError) executionStarted = false
      if (executionError) throw new FactoryRuntimeCleanupError([executionError])

      let applySnapshot: (() => Promise<void>) | null = null
      let captureError: unknown
      try {
        applySnapshot = await this.captureSnapshot(keeperName, input)
      } catch (error) {
        captureError = error
      }
      const cleanupErrors = await cleanup()
      if (cleanupErrors.length > 0) {
        throw new FactoryRuntimeCleanupError([...(captureError ? [captureError] : []), ...cleanupErrors])
      }
      if (captureError) throw captureError
      await applySnapshot!()
    }

    const volume = await this.command([
      'volume', 'create', '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs',
      '--opt', `o=size=8g,nr_inodes=500000,uid=${this.user.split(':')[0]},gid=${this.user.split(':')[1]},mode=0755`,
      volumeName,
    ], 30_000)
    if (!volume.ok) throw new Error(`[internal] failed to create isolated factory work volume: ${boundedOutput(volume.stderr)}`)
    volumeCreated = true

    const keeperArgs = [
      'run', '--detach', '--name', keeperName, '--pull=never', '--log-driver=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=32', '--memory=256m', '--cpus=0.5',
      '--network=none', '--user', this.user,
      '--tmpfs=/tmp:rw,nosuid,nodev,size=64m',
      '--mount', `type=bind,src=${input.checkoutPath},dst=/input/repository,readonly`,
      '--mount', `type=volume,src=${volumeName},dst=/workspace,volume-nocopy`,
      '--workdir', '/workspace',
      '--entrypoint=/bin/sh', image, '-lc',
      `set -eu; mkdir -p ${CONTAINER_CHECKOUT_PATH} ${CONTAINER_ARTIFACT_PATH}; cp -R /input/repository/. ${CONTAINER_CHECKOUT_PATH}; touch /workspace/.factory-ready; exec sleep infinity`,
    ]
    keeperStarted = true
    const keeper = await this.command(keeperArgs, 30_000)
    if (!keeper.ok) {
      const cleanupErrors = await cleanup()
      const startError = new Error(`[internal] isolated factory keeper failed to start: ${boundedOutput(keeper.stderr)}`)
      if (cleanupErrors.length > 0) throw new FactoryRuntimeCleanupError([startError, ...cleanupErrors])
      throw startError
    }
    const keeperReady = await this.command([
      'exec', keeperName, '/bin/sh', '-lc',
      'attempt=0; while [ "$attempt" -lt 100 ]; do [ -f /workspace/.factory-ready ] && exit 0; attempt=$((attempt + 1)); sleep 0.1; done; exit 1',
    ], 15_000)
    if (!keeperReady.ok) {
      const cleanupErrors = await cleanup()
      const startError = new Error('[internal] isolated factory keeper did not prepare the work volume')
      if (cleanupErrors.length > 0) throw new FactoryRuntimeCleanupError([startError, ...cleanupErrors])
      throw startError
    }

    const runArgs = [
      'run', '--detach', '--name', name, '--pull=never', '--log-driver=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=12g', '--cpus=2',
      '--network=bridge', '--add-host=host.docker.internal:host-gateway',
      '--publish', '127.0.0.1::4096', '--user', this.user,
      '--tmpfs=/tmp:rw,exec,nosuid,nodev,size=2g',
      '--env', `OPENCODE_SERVER_PASSWORD=${password}`,
      '--env', 'XDG_CACHE_HOME=/tmp/cache', '--env', 'XDG_DATA_HOME=/tmp/data',
      '--env', 'XDG_STATE_HOME=/tmp/state', '--env', 'COREPACK_HOME=/tmp/corepack',
      '--env', 'npm_config_cache=/tmp/npm-cache',
      '--mount', `type=volume,src=${volumeName},dst=/workspace,volume-nocopy`,
      '--mount', `type=bind,src=${configPath},dst=${CONTAINER_CONFIG_PATH},readonly`,
      '--workdir', CONTAINER_CHECKOUT_PATH,
      '--entrypoint=/bin/sh', image, '-lc',
      'exec opencode serve --hostname 0.0.0.0 --port 4096',
    ]

    executionStarted = true
    const started = await this.command(runArgs, 30_000)
    if (!started.ok) {
      const startError = new Error(`[internal] isolated factory container failed to start: ${boundedOutput(started.stderr)}`)
      const cleanupErrors = await cleanup()
      if (cleanupErrors.length > 0) throw new FactoryRuntimeCleanupError([startError, ...cleanupErrors])
      throw startError
    }
    try {
      const port = await this.command(['port', name, '4096/tcp'], 10_000)
      if (!port.ok) throw new Error(`[internal] failed to resolve isolated factory port: ${boundedOutput(port.stderr)}`)
      const hostPort = parsePublishedPort(port.stdout)
      const baseUrl = `http://127.0.0.1:${hostPort}`
      await this.healthcheck({ baseUrl, password })
      return { baseUrl, password, complete, stop }
    } catch (error) {
      const cleanupErrors = await cleanup()
      if (cleanupErrors.length > 0) throw new FactoryRuntimeCleanupError([error, ...cleanupErrors])
      throw error
    }
  }
}

export function createAuthorizingSessionStore(
  delegate: AgentRunSessionStore,
  authorizeSessionToken: (token: string) => void,
): AgentRunSessionStore {
  return {
    async open(input) {
      await delegate.open(input)
      try {
        authorizeSessionToken(input.sessionToken)
      } catch (error) {
        await delegate.dispose(input.sessionToken)
        throw error
      }
    },
    resolveActiveAgentId: (token) => delegate.resolveActiveAgentId(token),
    resolveActiveRunId: (token) => delegate.resolveActiveRunId(token),
    completeOutcome: (token, outcome) => delegate.completeOutcome(token, outcome),
    readOutcome: (token) => delegate.readOutcome(token),
    dispose: (token) => delegate.dispose(token),
  }
}

type AgentRuntimeLike = {
  run(agentId: string, input: unknown, ctx: AgentRunCtx): Promise<AgentResult>
}

type FactoryIsolatedAgentRuntimeDeps = {
  container: AwilixContainer
  commandBus: CommandBus
  checkoutConfig: CheckoutConfig
  startGateway(): Promise<FactoryRunGatewayAccess>
  containerSupervisor: FactoryContainerSupervisor
  createRuntime?: (container: AwilixContainer, commandBus: CommandBus) => AgentRuntimeLike
  prepareRunRoot?: (path: string) => Promise<void>
  removeRunRoot?: (path: string) => Promise<void>
}

export function createFactoryIsolatedAgentRuntime(deps: FactoryIsolatedAgentRuntimeDeps): AgentRuntimeLike {
  const createRuntime = deps.createRuntime ?? ((container, commandBus) => new AgentRuntimeService({ container, commandBus }))
  const parentRuntime = createRuntime(deps.container, deps.commandBus)
  const prepareRunRoot = deps.prepareRunRoot ?? (path => mkdir(path, { recursive: true, mode: 0o700 }).then(() => undefined))
  const removeRunRoot = deps.removeRunRoot ?? (path => rm(path, { recursive: true, force: true }))

  return {
    async run(agentId, rawInput, ctx) {
      if (agentId !== DEVELOPER_AGENT_ID) return parentRuntime.run(agentId, rawInput, ctx)

      const parsed = factoryInputSchema.parse(rawInput)
      const resolver = deps.container.resolve<RepositoryTargetResolver>('repositoryTargetResolver')
      const target = await resolver.resolveDelegationTarget({
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        delegationId: parsed.delegationId,
      })
      assertPreparedTarget(parsed, target)

      const checkout = checkoutPaths(deps.checkoutConfig, parsed.delegationId)
      const runRoot = join(deps.checkoutConfig.workspaceRoot, 'factory-runtime', parsed.delegationId)
      const artifactPath = join(runRoot, 'artifacts')
      const controlPath = join(runRoot, 'control')
      await prepareRunRoot(artifactPath)

      let gateway: FactoryRunGatewayAccess | null = null
      let handle: FactoryContainerHandle | null = null
      let child: AwilixContainer | null = null
      let result: AgentResult | undefined
      let runError: unknown
      const cleanupErrors: unknown[] = []

      try {
        gateway = await deps.startGateway()
        handle = await deps.containerSupervisor.start({
          delegationId: parsed.delegationId,
          checkoutPath: checkout.work,
          artifactPath,
          controlPath,
          checkoutConfig: deps.checkoutConfig,
          gateway,
        })
        child = deps.container.createScope()
        const installedStore = deps.container.resolve<AgentRunSessionStore>('agentRunSessionStore')
        child.register({
          openCodeClient: asValue(createOpenCodeClient({ baseUrl: handle.baseUrl, password: handle.password })),
          agentWorkspaceManager: asValue(new AgentWorkspaceManager({
            workspaceRoot: artifactPath,
            containerRoot: CONTAINER_ARTIFACT_PATH,
            poolSize: 1,
          })),
          agentRunSessionStore: asValue(createAuthorizingSessionStore(
            installedStore,
            token => gateway!.authorizeSessionToken(token),
          )),
        })
        const runtime = createRuntime(child, deps.commandBus)
        result = await runtime.run(agentId, {
          ...parsed,
          workDir: CONTAINER_CHECKOUT_PATH,
          repositoryFullName: target.fullName,
          baseBranch: target.baseBranch,
          verificationCommands: repositoryCommands(target),
        }, ctx)
      } catch (error) {
        runError = error
      }

      if (child) {
        try { await child.dispose() } catch (error) { cleanupErrors.push(error) }
      }
      let containerStopped = handle === null && !(runError instanceof FactoryRuntimeCleanupError)
      if (handle) {
        try {
          if (runError) await handle.stop()
          else await handle.complete()
          containerStopped = true
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      if (gateway) {
        try { await gateway.close() } catch (error) { cleanupErrors.push(error) }
      }
      if (containerStopped) {
        try { await removeRunRoot(runRoot) } catch (error) { cleanupErrors.push(error) }
      }

      if (cleanupErrors.length > 0) throw new FactoryRuntimeCleanupError(cleanupErrors)
      if (runError) throw runError
      return result as AgentResult
    },
  }
}

function assertPreparedTarget(input: Record<string, unknown>, target: ResolvedRepositoryTarget): void {
  if (typeof input.repositoryFullName === 'string' && input.repositoryFullName !== target.fullName) {
    throw new Error('[internal] prepared repository no longer matches the delegation target')
  }
  if (typeof input.baseBranch === 'string' && input.baseBranch !== target.baseBranch) {
    throw new Error('[internal] prepared base branch no longer matches the delegation target')
  }
}

function repositoryCommands(target: ResolvedRepositoryTarget): unknown {
  return target.profile.commands
}

function openCodeConfig(gateway: FactoryRunGatewayAccess): Record<string, unknown> {
  const model = gateway.model.replace(/^factory-gateway\//, '')
  return {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      'factory-gateway': {
        npm: '@ai-sdk/openai-compatible',
        options: { apiKey: gateway.providerApiKey, baseURL: gateway.providerBaseUrl },
        models: { [model]: {} },
      },
    },
    model: `factory-gateway/${model}`,
    tools: { write: true, edit: true, read: true, bash: true, glob: false, grep: false, todoread: false, todowrite: false },
    mcp: {
      'open-mercato': {
        type: 'remote',
        url: gateway.mcpUrl,
        headers: gateway.mcpHeaders,
        enabled: true,
      },
    },
    permission: { bash: { '*': 'allow' } },
    server: { port: 4096, hostname: '0.0.0.0' },
  }
}

function parsePublishedPort(output: string): number {
  const line = output.split('\n').map(value => value.trim()).find(Boolean)
  const match = line?.match(/:(\d+)$/)
  const port = match ? Number.parseInt(match[1]!, 10) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`[internal] invalid isolated factory port mapping: ${boundedOutput(output)}`)
  }
  return port
}

function boundedOutput(output: string): string {
  return output.trim().slice(0, 1_000) || 'no output'
}

async function captureFactorySnapshot(
  command: DockerCommand,
  keeperName: string,
  input: FactoryContainerStartInput,
): Promise<() => Promise<void>> {
  const runRoot = dirname(input.controlPath)
  const snapshotConfig: CheckoutConfig = {
    ...input.checkoutConfig,
    workspaceRoot: join(runRoot, 'snapshot'),
  }
  const snapshot = checkoutPaths(snapshotConfig, input.delegationId)
  await rm(snapshot.work, { recursive: true, force: true })
  await mkdir(snapshot.work, { recursive: true, mode: 0o700 })
  const exported = await command([
    'exec', keeperName, 'node', '/usr/local/bin/factory-export-source.mjs', CONTAINER_CHECKOUT_PATH,
  ], 5 * 60_000, FACTORY_EXPORT_BUFFER_BYTES)
  if (!exported.ok) throw new Error(`[internal] failed to export isolated factory output: ${boundedOutput(exported.stderr)}`)
  await materializeFactoryExport(exported.stdout, snapshot.work)

  let files: ChangedFile[] = []
  try {
    files = (await collectRepositoryChanges(snapshotConfig, input.delegationId)).files
  } catch (error) {
    if (!(error instanceof CheckoutError) || error.reason !== 'no_changes') throw error
  }
  return () => applySnapshotChanges(input.checkoutPath, files)
}

const factoryExportSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1), contentBase64: z.string(), executable: z.boolean() }).strict()).max(FACTORY_EXPORT_FILES),
}).strict()

async function materializeFactoryExport(serialized: string, root: string): Promise<void> {
  let raw: unknown
  try {
    raw = JSON.parse(serialized)
  } catch {
    throw new Error('[internal] isolated factory export was not valid JSON')
  }
  const exported = factoryExportSchema.parse(raw)
  const seen = new Set<string>()
  let bytes = 0
  for (const file of exported.files) {
    if (
      posix.isAbsolute(file.path)
      || posix.normalize(file.path) !== file.path
      || file.path === '..'
      || file.path.startsWith('../')
      || file.path === '.git'
      || file.path.startsWith('.git/')
      || isGenerated(file.path)
      || seen.has(file.path)
    ) {
      throw new Error('[internal] isolated factory export contained an invalid source path')
    }
    seen.add(file.path)
    const content = Buffer.from(file.contentBase64, 'base64')
    if (content.toString('base64') !== file.contentBase64 || content.byteLength > FACTORY_EXPORT_FILE_BYTES) {
      throw new Error('[internal] isolated factory export contained an invalid source file')
    }
    bytes += content.byteLength
    if (bytes > FACTORY_EXPORT_BYTES) {
      throw new Error('[internal] isolated factory export exceeded the byte limit')
    }
    const target = resolve(root, file.path)
    if (!target.startsWith(`${resolve(root)}/`)) throw new Error('[internal] isolated factory export escaped its snapshot')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { mode: file.executable ? 0o755 : 0o644, flag: 'wx' })
  }
}

async function applySnapshotChanges(root: string, files: ChangedFile[]): Promise<void> {
  for (const file of files) {
    const target = resolve(root, file.path)
    if (!target.startsWith(`${resolve(root)}/`)) throw new Error('[internal] isolated factory output escaped its checkout')
    await assertNoSymlinkParents(root, dirname(target))
    if (file.content === null) {
      await rm(target, { force: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content, 'utf8')
  }
}

async function assertNoSymlinkParents(root: string, targetDirectory: string): Promise<void> {
  const relativeDirectory = relative(root, targetDirectory)
  if (relativeDirectory.startsWith('..')) throw new Error('[internal] isolated factory output escaped its checkout')
  let current = resolve(root)
  for (const part of relativeDirectory.split('/').filter(Boolean)) {
    current = join(current, part)
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`[internal] isolated factory output targets an unsafe parent: ${relative(root, current)}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function waitForOpenCode(input: { baseUrl: string; password: string }): Promise<void> {
  const client = createOpenCodeClient(input)
  let lastError: unknown = new Error('OpenCode did not become ready')
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const health = await client.health()
      if (health.healthy) return
      lastError = new Error('OpenCode health response was not healthy')
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`[internal] isolated OpenCode readiness failed: ${errorMessage(lastError)}`)
}

const runDockerCommand: DockerCommand = (args, timeoutMs = 30_000, maxBufferBytes = 1024 * 1024) => new Promise((resolvePromise) => {
  execFile('docker', args, { timeout: timeoutMs, maxBuffer: maxBufferBytes }, (error, stdout, stderr) => {
    resolvePromise({ ok: !error, stdout: String(stdout), stderr: String(stderr) })
  })
})
