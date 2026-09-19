import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { createContainer, asValue } from 'awilix'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentRunSessionStore } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentRunSessionStore'

jest.mock('@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentRuntime', () => ({
  AgentRuntimeService: class {
    async run(): Promise<never> { throw new Error('unexpected installed runtime call') }
  },
}))

import {
  DockerFactoryContainerSupervisor,
  FactoryRuntimeCleanupError,
  createAuthorizingSessionStore,
  createFactoryIsolatedAgentRuntime,
  type DockerCommand,
  type FactoryContainerSupervisor,
  type FactoryRunGatewayAccess,
} from '../lib/isolated-runtime'

import { prepareRepositoryCheckout } from '../lib/repository-checkout'

const DELEGATION_ID = '11111111-1111-4111-8111-111111111111'
const execFileAsync = promisify(execFile)
const ctx = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }
const target = {
  repositoryId: 'repository-1', projectId: 'project-1', fullName: 'owner/site', baseBranch: 'main', kind: 'pr_only',
  profile: { commands: { install: 'corepack yarn install', build: 'corepack yarn build', test: 'corepack yarn test' } },
  configEpoch: 1, profileDigest: 'a'.repeat(64), githubRepositoryId: '1', installationId: '2', brokerAuthorizationId: '3',
}

function sessionStore(): AgentRunSessionStore {
  return {
    open: jest.fn<AgentRunSessionStore['open']>().mockResolvedValue(undefined),
    resolveActiveAgentId: jest.fn<AgentRunSessionStore['resolveActiveAgentId']>().mockResolvedValue('factory.developer'),
    resolveActiveRunId: jest.fn<AgentRunSessionStore['resolveActiveRunId']>().mockResolvedValue('run-1'),
    completeOutcome: jest.fn<AgentRunSessionStore['completeOutcome']>().mockResolvedValue('completed'),
    readOutcome: jest.fn<AgentRunSessionStore['readOutcome']>().mockResolvedValue({ done: false }),
    dispose: jest.fn<AgentRunSessionStore['dispose']>().mockResolvedValue(undefined),
  }
}

function gateway(events: string[] = []): FactoryRunGatewayAccess {
  return {
    providerBaseUrl: 'http://host.docker.internal:4100/v1',
    providerApiKey: 'scoped-provider-token',
    model: 'openrouter/free',
    mcpUrl: 'http://host.docker.internal:4200/mcp',
    mcpHeaders: { 'x-factory-run-token': 'scoped-mcp-token' },
    authorizeSessionToken: (token) => events.push(`authorize:${token}`),
    close: async () => { events.push('gateway:close') },
  }
}

function runtimeHarness(options: { runError?: Error; resolverError?: Error } = {}) {
  const events: string[] = []
  const parentStore = sessionStore()
  const resolveDelegationTarget = jest.fn(async (_input: { tenantId?: string; organizationId?: string; delegationId: string }) => {
    if (options.resolverError) throw options.resolverError
    return target
  })
  const container = createContainer()
  container.register({
    agentRunSessionStore: asValue(parentStore),
    repositoryTargetResolver: asValue({ resolveDelegationTarget }),
  })
  const childRun = jest.fn(async (_agentId: string, input: unknown, _runCtx: typeof ctx) => {
    events.push('runtime:run')
    const scopedStore = container.createScope().resolve<AgentRunSessionStore>('agentRunSessionStore')
    void scopedStore
    if (options.runError) throw options.runError
    return { kind: 'research' as const, data: input }
  })
  const parentRun = jest.fn(async (_agentId: string, _input: unknown, _runCtx: typeof ctx) => ({ kind: 'research' as const, data: 'passthrough' }))
  const start = jest.fn<FactoryContainerSupervisor['start']>(async (input) => {
    events.push(`container:start:${input.checkoutPath}:${input.artifactPath}`)
      return {
        baseUrl: 'http://127.0.0.1:49152',
        password: 'server-password',
        complete: async () => {
          events.push('container:stop')
          events.push('snapshot:apply')
        },
        stop: async () => { events.push('container:stop') },
    }
  })
  const supervisor: FactoryContainerSupervisor = {
    start,
  }
  const isolated = createFactoryIsolatedAgentRuntime({
    container,
    commandBus: {} as never,
    checkoutConfig: {
      repo: 'owner/site', baseBranch: 'main', workspaceRoot: '/host/work',
      containerWorkspaceRoot: '/unused/global/root', gitRoot: '/host/git',
    },
    startGateway: async () => gateway(events),
    containerSupervisor: supervisor,
    createRuntime: (scope) => scope === container ? { run: parentRun } : { run: childRun },
    prepareRunRoot: async () => undefined,
    removeRunRoot: async () => { events.push('run-root:remove') },
  })
  return { childRun, container, events, isolated, parentRun, resolveDelegationTarget, supervisor }
}

describe('factory isolated agent runtime', () => {
  it('passes non-factory agents through the installed runtime unchanged', async () => {
    const harness = runtimeHarness()
    await expect(harness.isolated.run('other.agent', { value: 1 }, ctx)).resolves.toEqual({ kind: 'research', data: 'passthrough' })
    expect(harness.parentRun).toHaveBeenCalledWith('other.agent', { value: 1 }, ctx)
    expect(harness.resolveDelegationTarget).not.toHaveBeenCalled()
    expect(harness.supervisor.start).not.toHaveBeenCalled()
  })

  it('derives the checkout from the trusted delegation and passes only the container path to the developer', async () => {
    const harness = runtimeHarness()
    await harness.isolated.run('factory.developer', {
      delegationId: DELEGATION_ID,
      workDir: '/attacker/chosen/path',
      repositoryFullName: 'owner/site',
      baseBranch: 'main',
    }, ctx)

    expect(harness.resolveDelegationTarget).toHaveBeenCalledWith({
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      delegationId: DELEGATION_ID,
    })
    expect(harness.supervisor.start).toHaveBeenCalledWith(expect.objectContaining({
      checkoutPath: `/host/work/factory/${DELEGATION_ID}`,
      artifactPath: `/host/work/factory-runtime/${DELEGATION_ID}/artifacts`,
    }))
    expect(harness.childRun).toHaveBeenCalledWith('factory.developer', expect.objectContaining({
      delegationId: DELEGATION_ID,
      workDir: '/workspace/repository',
      repositoryFullName: 'owner/site',
      baseBranch: 'main',
      verificationCommands: target.profile.commands,
    }), ctx)
    expect(harness.events.indexOf('container:stop')).toBeLessThan(harness.events.indexOf('run-root:remove'))
  })

  it('refuses a delegation outside the current tenant or organization before starting infrastructure', async () => {
    const harness = runtimeHarness({ resolverError: new Error('binding_unavailable') })
    await expect(harness.isolated.run('factory.developer', { delegationId: DELEGATION_ID }, ctx)).rejects.toThrow('binding_unavailable')
    expect(harness.supervisor.start).not.toHaveBeenCalled()
    expect(harness.events).toEqual([])
  })

  it.each([undefined, new Error('agent failed')])('stops the container before returning from success or failure', async (runError) => {
    const harness = runtimeHarness({ ...(runError ? { runError } : {}) })
    const run = harness.isolated.run('factory.developer', { delegationId: DELEGATION_ID }, ctx)
    if (runError) await expect(run).rejects.toThrow('agent failed')
    else await expect(run).resolves.toEqual(expect.objectContaining({ kind: 'research' }))
    expect(harness.events).toContain('container:stop')
    expect(harness.events.indexOf('container:stop')).toBeLessThan(harness.events.indexOf('gateway:close'))
  })

  it('fails closed and preserves the run root when container removal cannot be verified', async () => {
    const harness = runtimeHarness()
    ;(harness.supervisor.start as jest.MockedFunction<FactoryContainerSupervisor['start']>).mockResolvedValue({
      baseUrl: 'http://127.0.0.1:49152',
      password: 'server-password',
      complete: async () => { throw new Error('container still present') },
      stop: async () => { throw new Error('container still present') },
    })
    await expect(harness.isolated.run('factory.developer', { delegationId: DELEGATION_ID }, ctx))
      .rejects.toMatchObject({ code: 'factory_runtime_cleanup_unverified' })
    expect(harness.events).not.toContain('run-root:remove')
    expect(harness.events).toContain('gateway:close')
  })

  it('preserves the run root when container startup reports unverified cleanup', async () => {
    const harness = runtimeHarness()
    ;(harness.supervisor.start as jest.MockedFunction<FactoryContainerSupervisor['start']>)
      .mockRejectedValue(new FactoryRuntimeCleanupError([new Error('container still present')]))
    await expect(harness.isolated.run('factory.developer', { delegationId: DELEGATION_ID }, ctx))
      .rejects.toMatchObject({ code: 'factory_runtime_cleanup_unverified' })
    expect(harness.events).not.toContain('run-root:remove')
    expect(harness.events).toContain('gateway:close')
  })
})

describe('authorizing session store', () => {
  it('authorizes the exact installed session token after opening the shared outcome row', async () => {
    const events: string[] = []
    const delegate = sessionStore()
    ;(delegate.open as jest.MockedFunction<AgentRunSessionStore['open']>).mockImplementation(async () => { events.push('store:open') })
    const store = createAuthorizingSessionStore(delegate, (token) => { events.push(`authorize:${token}`) })
    await store.open({ sessionToken: 'session-token', agentId: 'factory.developer', runId: 'run-1', tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(events).toEqual(['store:open', 'authorize:session-token'])
    await store.dispose('session-token')
    expect(delegate.dispose).toHaveBeenCalledWith('session-token')
  })
})

describe('Docker factory container supervisor', () => {
  let root: string

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('uses a bounded private tmpfs volume and never mounts the host checkout into the untrusted container', async () => {
    root = await mkdtemp(join(tmpdir(), 'factory-runtime-'))
    const checkoutPath = join(root, 'work', 'factory', DELEGATION_ID)
    const artifactPath = join(root, 'work', 'factory-runtime', DELEGATION_ID, 'artifacts')
    const controlPath = join(root, 'work', 'factory-runtime', DELEGATION_ID, 'control')
    await mkdir(checkoutPath, { recursive: true })
    await mkdir(artifactPath, { recursive: true })
    await mkdir(controlPath, { recursive: true })
    const calls: string[][] = []
    const command: DockerCommand = async (args) => {
      calls.push(args)
      if (args[0] === 'run') return { ok: true, stdout: 'container-id\n', stderr: '' }
      if (args[0] === 'port') return { ok: true, stdout: '127.0.0.1:49152\n', stderr: '' }
      if (args[0] === 'volume' && args[1] === 'inspect') return { ok: false, stdout: '', stderr: 'not found' }
      if (args[0] === 'ps') return { ok: true, stdout: '', stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const supervisor = new DockerFactoryContainerSupervisor({
      image: 'factory-opencode:test',
      command,
      healthcheck: async () => undefined,
      user: '1000:1000',
    })
    const checkoutConfig = {
      repo: 'owner/site', baseBranch: 'main', workspaceRoot: join(root, 'work'),
      containerWorkspaceRoot: '/unused', gitRoot: join(root, 'git'),
    }
    const handle = await supervisor.start({
      delegationId: DELEGATION_ID,
      checkoutPath,
      artifactPath,
      controlPath,
      checkoutConfig,
      gateway: gateway(),
    })
    const volumeCreate = calls.find((args) => args[0] === 'volume' && args[1] === 'create')!
    expect(volumeCreate).toEqual(expect.arrayContaining([
      '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs',
      '--opt', 'o=size=8g,nr_inodes=500000,uid=1000,gid=1000,mode=0755',
    ]))
    const runCalls = calls.filter((args) => args[0] === 'run')
    const keeperArgs = runCalls.find((args) => args.includes(`om-factory-${DELEGATION_ID}-keeper`))!
    expect(keeperArgs.filter((arg) => arg.startsWith('type=bind,'))).toEqual([
      `type=bind,src=${checkoutPath},dst=/input/repository,readonly`,
    ])
    expect(keeperArgs).toContain(`type=volume,src=om-factory-${DELEGATION_ID}-work,dst=/workspace,volume-nocopy`)
    expect(keeperArgs).toEqual(expect.arrayContaining(['--workdir', '/workspace']))
    const runArgs = runCalls.find((args) => args.includes(`om-factory-${DELEGATION_ID}`) && !args.includes(`om-factory-${DELEGATION_ID}-keeper`))!
    expect(runArgs.filter((arg) => arg.startsWith('type=bind,'))).toEqual([
      `type=bind,src=${join(controlPath, 'opencode.json')},dst=/home/opencode/.config/opencode/opencode.json,readonly`,
    ])
    expect(runArgs).toContain(`type=volume,src=om-factory-${DELEGATION_ID}-work,dst=/workspace,volume-nocopy`)
    expect(runArgs.join(' ')).not.toContain(checkoutPath)
    expect(runArgs.join(' ')).not.toContain('/host/git')
    expect(runArgs.join(' ')).not.toContain('/var/run/docker.sock')
    expect(runArgs).toEqual(expect.arrayContaining(['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=12g', '--cpus=2']))
    await handle.stop()
    expect(calls).toContainEqual(expect.arrayContaining(['rm', '--force']))
    expect(calls).toContainEqual(['volume', 'rm', `om-factory-${DELEGATION_ID}-work`])
    expect(calls.at(-1)).toEqual(['volume', 'ls', '--filter', `name=^om-factory-${DELEGATION_ID}-work$`, '--format', '{{.Name}}'])
  })

  it('rejects cleanup when Docker still reports the container after force removal', async () => {
    root = await mkdtemp(join(tmpdir(), 'factory-runtime-'))
    const checkoutPath = join(root, 'checkout')
    const artifactPath = join(root, 'artifacts')
    const controlPath = join(root, 'control')
    await Promise.all([mkdir(checkoutPath), mkdir(artifactPath), mkdir(controlPath)])
    const command: DockerCommand = async (args) => {
      if (args[0] === 'port') return { ok: true, stdout: '127.0.0.1:49152\n', stderr: '' }
      if (args[0] === 'volume' && args[1] === 'inspect') return { ok: false, stdout: '', stderr: 'not found' }
      if (args[0] === 'ps') return { ok: true, stdout: `om-factory-${DELEGATION_ID}\n`, stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const supervisor = new DockerFactoryContainerSupervisor({ image: 'factory-opencode:test', command, healthcheck: async () => undefined, user: '1000:1000' })
    const checkoutConfig = { repo: 'owner/site', baseBranch: 'main', workspaceRoot: root, containerWorkspaceRoot: '/unused', gitRoot: join(root, 'git') }
    const handle = await supervisor.start({ delegationId: DELEGATION_ID, checkoutPath, artifactPath, controlPath, checkoutConfig, gateway: gateway() })
    await expect(handle.stop()).rejects.toMatchObject({ code: 'factory_runtime_cleanup_unverified' })
  })

  it('removes the untrusted container before trusted export and applies only after all runtime resources are gone', async () => {
    root = await mkdtemp(join(tmpdir(), 'factory-runtime-'))
    const checkoutPath = join(root, 'checkout')
    const artifactPath = join(root, 'artifacts')
    const controlPath = join(root, 'control')
    await Promise.all([mkdir(checkoutPath), mkdir(artifactPath), mkdir(controlPath)])
    const events: string[] = []
    const command: DockerCommand = async (args) => {
      events.push(`docker:${args.join(':')}`)
      if (args[0] === 'port') return { ok: true, stdout: '127.0.0.1:49152\n', stderr: '' }
      if (args[0] === 'volume' && args[1] === 'inspect') return { ok: false, stdout: '', stderr: 'not found' }
      if (args[0] === 'ps') return { ok: true, stdout: '', stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const supervisor = new DockerFactoryContainerSupervisor({
      image: 'factory-opencode:test', command, healthcheck: async () => undefined, user: '1000:1000',
      captureSnapshot: async () => {
        events.push('snapshot:capture')
        return async () => { events.push('snapshot:apply') }
      },
    })
    const checkoutConfig = { repo: 'owner/site', baseBranch: 'main', workspaceRoot: root, containerWorkspaceRoot: '/unused', gitRoot: join(root, 'git') }
    const handle = await supervisor.start({ delegationId: DELEGATION_ID, checkoutPath, artifactPath, controlPath, checkoutConfig, gateway: gateway() })
    await handle.complete()
    const executionRemoval = events.findIndex((event) => event === `docker:rm:--force:om-factory-${DELEGATION_ID}`)
    const executionVerification = events.findIndex((event) => event.includes(`docker:ps:--all:--filter:name=^/om-factory-${DELEGATION_ID}$`))
    const keeperRemoval = events.findIndex((event) => event === `docker:rm:--force:om-factory-${DELEGATION_ID}-keeper`)
    const volumeVerification = events.findIndex((event) => event === `docker:volume:ls:--filter:name=^om-factory-${DELEGATION_ID}-work$:--format:{{.Name}}`, executionVerification + 1)
    expect(executionRemoval).toBeLessThan(executionVerification)
    expect(executionVerification).toBeLessThan(events.indexOf('snapshot:capture'))
    expect(events.indexOf('snapshot:capture')).toBeLessThan(keeperRemoval)
    expect(volumeVerification).toBeLessThan(events.indexOf('snapshot:apply'))
  })

  it('removes the keeper and volume when bounded export fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'factory-runtime-'))
    const checkoutPath = join(root, 'checkout')
    const artifactPath = join(root, 'artifacts')
    const controlPath = join(root, 'control')
    await Promise.all([mkdir(checkoutPath), mkdir(artifactPath), mkdir(controlPath)])
    const calls: string[][] = []
    const command: DockerCommand = async (args) => {
      calls.push(args)
      if (args[0] === 'port') return { ok: true, stdout: '127.0.0.1:49152\n', stderr: '' }
      if (args[0] === 'volume' && args[1] === 'inspect') return { ok: false, stdout: '', stderr: 'not found' }
      if (args[0] === 'ps') return { ok: true, stdout: '', stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const supervisor = new DockerFactoryContainerSupervisor({
      image: 'factory-opencode:test', command, healthcheck: async () => undefined, user: '1000:1000',
      captureSnapshot: async () => { throw new Error('bounded export failed') },
    })
    const checkoutConfig = { repo: 'owner/site', baseBranch: 'main', workspaceRoot: root, containerWorkspaceRoot: '/unused', gitRoot: join(root, 'git') }
    const handle = await supervisor.start({ delegationId: DELEGATION_ID, checkoutPath, artifactPath, controlPath, checkoutConfig, gateway: gateway() })

    await expect(handle.complete()).rejects.toThrow('bounded export failed')
    expect(calls).toContainEqual(['rm', '--force', `om-factory-${DELEGATION_ID}-keeper`])
    expect(calls).toContainEqual(['volume', 'rm', `om-factory-${DELEGATION_ID}-work`])
    expect(calls.at(-1)).toEqual(['volume', 'ls', '--filter', `name=^om-factory-${DELEGATION_ID}-work$`, '--format', '{{.Name}}'])
  })

  it.each([
    { failedRun: 1, containerName: `om-factory-${DELEGATION_ID}-keeper` },
    { failedRun: 2, containerName: `om-factory-${DELEGATION_ID}` },
  ])('reconciles a container when Docker run $failedRun returns an ambiguous failure', async ({ failedRun, containerName }) => {
    root = await mkdtemp(join(tmpdir(), 'factory-runtime-'))
    const checkoutPath = join(root, 'checkout')
    const artifactPath = join(root, 'artifacts')
    const controlPath = join(root, 'control')
    await Promise.all([mkdir(checkoutPath), mkdir(artifactPath), mkdir(controlPath)])
    const calls: string[][] = []
    let runCount = 0
    const command: DockerCommand = async (args) => {
      calls.push(args)
      if (args[0] === 'run') {
        runCount += 1
        if (runCount === failedRun) return { ok: false, stdout: '', stderr: 'request timed out' }
      }
      if (args[0] === 'volume' && args[1] === 'inspect') return { ok: false, stdout: '', stderr: 'not found' }
      if (args[0] === 'ps') return { ok: true, stdout: '', stderr: '' }
      if (args[0] === 'volume' && args[1] === 'ls') return { ok: true, stdout: '', stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const supervisor = new DockerFactoryContainerSupervisor({ image: 'factory-opencode:test', command, healthcheck: async () => undefined, user: '1000:1000' })
    const checkoutConfig = { repo: 'owner/site', baseBranch: 'main', workspaceRoot: root, containerWorkspaceRoot: '/unused', gitRoot: join(root, 'git') }

    await expect(supervisor.start({ delegationId: DELEGATION_ID, checkoutPath, artifactPath, controlPath, checkoutConfig, gateway: gateway() }))
      .rejects.toThrow('failed to start')
    expect(calls).toContainEqual(['rm', '--force', containerName])
    expect(calls).toContainEqual(['ps', '--all', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}'])
  })

  it('fails cleanup closed when Docker cannot prove the work volume is absent', async () => {
    root = await mkdtemp(join(tmpdir(), 'factory-runtime-'))
    const checkoutPath = join(root, 'checkout')
    const artifactPath = join(root, 'artifacts')
    const controlPath = join(root, 'control')
    await Promise.all([mkdir(checkoutPath), mkdir(artifactPath), mkdir(controlPath)])
    const command: DockerCommand = async (args) => {
      if (args[0] === 'port') return { ok: true, stdout: '127.0.0.1:49152\n', stderr: '' }
      if (args[0] === 'volume' && args[1] === 'inspect') return { ok: false, stdout: '', stderr: 'not found' }
      if (args[0] === 'volume' && args[1] === 'ls') return { ok: false, stdout: '', stderr: 'daemon unavailable' }
      if (args[0] === 'ps') return { ok: true, stdout: '', stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const supervisor = new DockerFactoryContainerSupervisor({ image: 'factory-opencode:test', command, healthcheck: async () => undefined, user: '1000:1000' })
    const checkoutConfig = { repo: 'owner/site', baseBranch: 'main', workspaceRoot: root, containerWorkspaceRoot: '/unused', gitRoot: join(root, 'git') }
    const handle = await supervisor.start({ delegationId: DELEGATION_ID, checkoutPath, artifactPath, controlPath, checkoutConfig, gateway: gateway() })

    await expect(handle.stop()).rejects.toMatchObject({ code: 'factory_runtime_cleanup_unverified' })
  })
})

describe('factory source exporter', () => {
  let root: string

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('exports source as base64 JSON and omits generated directories', async () => {
    root = await mkdtemp(join(tmpdir(), 'factory-export-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'package'), { recursive: true })
    await writeFile(join(root, 'src', 'index.ts'), 'export const answer = 42\n')
    await writeFile(join(root, 'node_modules', 'package', 'index.js'), 'generated')
    const script = join(process.cwd(), 'docker', 'factory-runner', 'export-source.mjs')

    const { stdout } = await execFileAsync(process.execPath, [script, root])
    const payload = JSON.parse(stdout) as { files: Array<{ path: string; contentBase64: string }> }
    expect(payload.files).toEqual([{
      path: 'src/index.ts',
      executable: false,
      contentBase64: Buffer.from('export const answer = 42\n').toString('base64'),
    }])
  })

  it('rejects links and container-local git metadata', async () => {
    root = await mkdtemp(join(tmpdir(), 'factory-export-'))
    await writeFile(join(root, 'source.txt'), 'source')
    await symlink(join(root, 'source.txt'), join(root, 'link.txt'))
    const script = join(process.cwd(), 'docker', 'factory-runner', 'export-source.mjs')
    await expect(execFileAsync(process.execPath, [script, root])).rejects.toThrow('source contains a symbolic link')

    await rm(join(root, 'link.txt'))
    await mkdir(join(root, '.git'))
    await expect(execFileAsync(process.execPath, [script, root])).rejects.toThrow('source contains a protected directory')
  })
})


it.each(['binary', 'executable'])('validates %s snapshot bytes before applying them to the host', async (kind) => {
  const root = await mkdtemp(join(tmpdir(), 'factory-copy-'))
  const checkoutConfig = { repo: 'owner/site', baseBranch: 'main', workspaceRoot: join(root, 'work'), containerWorkspaceRoot: '/work', gitRoot: join(root, 'git') }
  const checkoutPath = join(checkoutConfig.workspaceRoot, 'factory', DELEGATION_ID)
  const controlPath = join(root, 'control')
  try {
    await prepareRepositoryCheckout(checkoutConfig, DELEGATION_ID, { baseSha: 'a'.repeat(40), files: [{ path: 'run.sh', content: Buffer.from('before\n').toString('base64'), executable: true }] })
    const command: DockerCommand = async (args) => {
      if (args[0] === 'volume' && args[1] === 'inspect') return { ok: false, stdout: '', stderr: 'not found' }
      if (args[0] === 'port') return { ok: true, stdout: '127.0.0.1:49152', stderr: '' }
      if (args.includes('/usr/local/bin/factory-export-source.mjs')) return { ok: true, stdout: JSON.stringify({ files: [{ path: 'run.sh', executable: true, contentBase64: (kind === 'binary' ? Buffer.from([255, 128, 0]) : Buffer.from('after\n')).toString('base64') }] }), stderr: '' }
      return { ok: true, stdout: '', stderr: '' }
    }
    const supervisor = new DockerFactoryContainerSupervisor({ image: 'fixture:local', command, healthcheck: async () => undefined })
    const handle = await supervisor.start({ delegationId: DELEGATION_ID, checkoutPath, checkoutConfig, controlPath, artifactPath: join(root, 'artifacts'), gateway: gateway() })
    if (kind === 'binary') {
      await expect(handle.complete()).rejects.toThrow('Binary changes are unsupported')
      expect(await readFile(join(checkoutPath, 'run.sh'), 'utf8')).toBe('before\n')
    } else {
      await handle.complete()
      expect(await readFile(join(checkoutPath, 'run.sh'), 'utf8')).toBe('after\n')
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
