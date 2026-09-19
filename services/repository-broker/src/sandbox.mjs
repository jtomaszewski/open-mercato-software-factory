import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const MAX_OUTPUT_BYTES = 64 * 1024
const CHECKOUT_WORKSPACE_SIZE = '512m'
const COMMAND_WORKSPACE_SIZE = '8g'
const WORKSPACE_INSPECT_SCRIPT = [
  "const fs = require('node:fs')",
  "const path = require('node:path')",
  'const root = process.argv[1], maximumFiles = Number(process.argv[2]), maximumBytes = Number(process.argv[3])',
  'let files = 0, bytes = 0, valid = true',
  'const inspect = (target) => { const entry = fs.lstatSync(target); if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) { valid = false; return } if (entry.isFile()) { files += 1; bytes += entry.size; return } for (const child of fs.readdirSync(target)) inspect(path.join(target, child)) }',
  'try { if (!fs.lstatSync(root).isDirectory()) valid = false; else inspect(root) } catch { valid = false }',
  'if (!valid || files > maximumFiles || bytes > maximumBytes) process.exit(1)',
].join('; ')

function runProcess(command, args, { captureOutput = false, cwd, env, input, timeoutMs }, tracker) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    tracker?.add(child)
    let outputBytes = 0
    const output = []
    const drain = (chunk) => {
      const retained = Math.min(chunk.length, Math.max(0, MAX_OUTPUT_BYTES - outputBytes))
      if (captureOutput && retained > 0) output.push(chunk.subarray(0, retained))
      outputBytes += retained
    }
    child.stdout.on('data', drain)
    child.stderr.on('data', drain)
    if (input !== undefined) child.stdin.end(input)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.once('error', () => {
      clearTimeout(timer)
      tracker?.delete(child)
      resolve({ ok: false, timedOut: false, spawnFailed: true, output: Buffer.concat(output).toString('utf8') })
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      tracker?.delete(child)
      resolve({ ok: code === 0 && signal === null, timedOut, spawnFailed: false, output: Buffer.concat(output).toString('utf8') })
    })
  })
}

function prepareWorkspace(path) {
  const pending = [path]
  let entries = 0
  let bytes = 0
  while (pending.length > 0) {
    const currentPath = pending.pop()
    const entry = lstatSync(currentPath)
    entries += 1
    if (entries > 100_000 || entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) return false
    if (entry.isFile()) {
      bytes += entry.size
      if (bytes > 768 * 1024 * 1024) return false
      chmodSync(currentPath, (entry.mode & 0o111) === 0 ? 0o666 : 0o777)
    } else {
      chmodSync(currentPath, 0o777)
      for (const child of readdirSync(currentPath)) pending.push(join(currentPath, child))
    }
  }
  return true
}

export class SandboxRunner {
  constructor({ image, commandTimeoutMs, executionPath = process.env.PATH, now = () => Date.now() }) {
    this.image = image
    this.commandTimeoutMs = commandTimeoutMs
    this.executionPath = executionPath
    this.now = now
    this.activeContainers = new Set()
    this.activeProcesses = new Set()
    this.activeRuns = new Set()
    this.closing = false
  }

  timeout(deadlineMs, maximumMs) {
    if (deadlineMs === undefined) return maximumMs
    const remainingMs = Math.floor(deadlineMs - this.now())
    if (remainingMs <= 0) throw new Error('sandbox_deadline_exceeded')
    return Math.min(maximumMs, remainingMs)
  }

  async process(args, { captureOutput = false, cwd, input, timeoutMs }) {
    return runProcess('docker', args, {
      captureOutput, cwd, input, timeoutMs, env: { PATH: this.executionPath },
    }, this.activeProcesses)
  }

  cleanupError() {
    const error = new Error('sandbox_cleanup_unverified')
    error.code = 'sandbox_cleanup_unverified'
    return error
  }

  async containerPresent(name, cwd = tmpdir()) {
    const listed = await this.process([
      'ps', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}',
    ], { captureOutput: true, cwd, timeoutMs: 5_000 })
    if (!listed.ok) return null
    return listed.output.split('\n').some((entry) => entry.trim() === name)
  }

  async cleanupContainer(name) {
    const execution = { cwd: tmpdir(), timeoutMs: 5_000 }
    const inspection = await this.process(['container', 'inspect', name], execution)
    if (!inspection.ok) {
      const present = await this.containerPresent(name)
      if (present === false) {
        this.activeContainers.delete(name)
        return true
      }
      if (present === null) return false
    }
    const cleanup = await this.process(['rm', '--force', name], { ...execution, timeoutMs: 15_000 })
    if (!cleanup.ok || await this.containerPresent(name) !== false) return false
    this.activeContainers.delete(name)
    return true
  }

  async stop() {
    this.closing = true
    for (const child of [...this.activeProcesses]) child.kill('SIGKILL')
    const firstCleanup = await Promise.all([...this.activeContainers].map((name) => this.cleanupContainer(name)))
    await Promise.all([...this.activeRuns])
    const finalCleanup = await Promise.all([...this.activeContainers].map((name) => this.cleanupContainer(name)))
    return [...firstCleanup, ...finalCleanup].every(Boolean)
  }

  async reconcileAttempt({ attemptId, profile }) {
    const names = [
      `om-rq-${attemptId}-checkout`,
      `om-rq-${attemptId}-commands`,
      ...['install', 'build', 'test', 'typecheck', 'lint']
        .filter((name) => profile.commands[name])
        .map((name) => `om-rq-${attemptId}-${name}`),
    ]
    const results = await Promise.all(names.map((name) => this.cleanupContainer(name)))
    if (!results.every(Boolean)) throw this.cleanupError()
  }

  async run(input) {
    let finish
    const completion = new Promise((resolve) => { finish = resolve })
    this.activeRuns.add(completion)
    try {
      return await this.runQualification(input)
    } catch (error) {
      if (error?.message === 'sandbox_stopping') {
        return [{ id: 'sandbox.shutdown', status: 'failed', message: 'The qualification sandbox stopped before the check completed.' }]
      }
      throw error
    } finally {
      finish()
      this.activeRuns.delete(completion)
    }
  }

  baseContainerArgs(name, attemptId, workspaceSize) {
    return [
      'run', '--detach', '--name', name, '--pull=never', '--log-driver=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--pids-limit=256',
      `--memory=${workspaceSize === COMMAND_WORKSPACE_SIZE ? '12g' : '1g'}`, '--cpus=2',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=256m',
      `--tmpfs=/workspace:rw,exec,nosuid,size=${workspaceSize},nr_inodes=${workspaceSize === COMMAND_WORKSPACE_SIZE ? 500000 : 100000},uid=65534,gid=65534,mode=1777`,
      '--label', `org.open-mercato.qualification-attempt=${attemptId}`,
    ]
  }

  async startCheckoutContainer({ root, askpass, tokenFile, attemptId, deadlineMs }) {
    const containerName = `om-rq-${attemptId}-checkout`
    const exportDirectory = join(root, "workspace")
    chmodSync(exportDirectory, 0o777)
    if (!await this.cleanupContainer(containerName)) throw this.cleanupError()
    this.activeContainers.add(containerName)
    const started = await this.process([
      ...this.baseContainerArgs(containerName, attemptId, CHECKOUT_WORKSPACE_SIZE),
      '--mount', `type=bind,src=${exportDirectory},dst=/export`,
      '--network=bridge', '--tmpfs=/run/secrets:rw,exec,nodev,nosuid,size=64k,nr_inodes=16,uid=65534,gid=65534,mode=0700',
      '--entrypoint=/bin/sh', this.image, '-lc', 'while :; do sleep 3600; done',
    ], { cwd: root, timeoutMs: this.timeout(deadlineMs, 30_000) })
    if (!started.ok) return started
    const tokenProvisioned = await this.process([
      'exec', '--interactive', '--user=65534:65534', containerName, '/bin/sh', '-c',
      'umask 077; cat > /run/secrets/github-token',
    ], { cwd: root, input: readFileSync(tokenFile), timeoutMs: this.timeout(deadlineMs, 5_000) })
    if (!tokenProvisioned.ok) return tokenProvisioned
    return this.process([
      'exec', '--interactive', '--user=65534:65534', containerName, '/bin/sh', '-c',
      'umask 077; cat > /run/secrets/askpass; chmod 0700 /run/secrets/askpass',
    ], { cwd: root, input: readFileSync(askpass), timeoutMs: this.timeout(deadlineMs, 5_000) })
  }

  async checkout({ root, workspace, askpass, tokenFile, fullName, baseSha, attemptId, deadlineMs }) {
    const containerName = `om-rq-${attemptId}-checkout`
    try {
      const started = await this.startCheckoutContainer({ root, askpass, tokenFile, attemptId, deadlineMs })
      if (!started.ok) return false
      const checkoutScript = [
        'set -eu',
        'git -c credential.helper= -c core.hooksPath=/dev/null -c protocol.file.allow=never init /workspace',
        'git -C /workspace remote add origin "https://github.com/$1.git"',
        'git -C /workspace -c credential.helper= -c core.hooksPath=/dev/null -c protocol.file.allow=never -c http.followRedirects=false fetch --depth=1 --no-tags origin "$2"',
        'git -C /workspace -c core.hooksPath=/dev/null checkout --detach "$2"',
        'rm -rf /workspace/.git',
      ].join('; ')
      const checkout = await this.process([
        'exec', '--user=65534:65534',
        '--env=HOME=/tmp', '--env=GIT_CONFIG_NOSYSTEM=1', '--env=GIT_CONFIG_GLOBAL=/dev/null',
        '--env=GIT_ASKPASS=/run/secrets/askpass', '--env=GIT_TERMINAL_PROMPT=0',
        '--env=OM_GITHUB_TOKEN_FILE=/run/secrets/github-token',
        containerName, '/bin/sh', '-c', checkoutScript, 'broker-checkout', fullName, baseSha,
      ], { cwd: root, timeoutMs: this.timeout(deadlineMs, 180_000) })
      if (!checkout.ok) return false
      const inspected = await this.process([
        'exec', '--user=65534:65534', containerName, 'node', '-e', WORKSPACE_INSPECT_SCRIPT,
        '/workspace', '100000', String(512 * 1024 * 1024),
      ], { cwd: root, timeoutMs: this.timeout(deadlineMs, 30_000) })
      if (!inspected.ok) return false
      const copied = await this.process(['exec', '--user=65534:65534', containerName, '/bin/cp', '-R', '/workspace/.', '/export'], {
        cwd: root, timeoutMs: this.timeout(deadlineMs, 60_000),
      })
      return copied.ok
    } finally {
      rmSync(tokenFile, { force: true })
      rmSync(askpass, { force: true })
      if (!await this.cleanupContainer(containerName)) throw this.cleanupError()
    }
  }

  async runCommands({ root, workspace, attemptId, profile, kind, deadlineMs }) {
    const containerName = `om-rq-${attemptId}-commands`
    if (!await this.cleanupContainer(containerName)) throw this.cleanupError()
    this.activeContainers.add(containerName)
    try {
      const started = await this.process([
        ...this.baseContainerArgs(containerName, attemptId, COMMAND_WORKSPACE_SIZE),
        '--mount', `type=bind,src=${workspace},dst=/source,readonly`,
        '--tmpfs=/home/broker:rw,nosuid,size=3g,nr_inodes=100000,uid=65534,gid=65534,mode=0700',
        '--network=bridge', '--entrypoint=/bin/sh', this.image, '-lc', 'while :; do sleep 3600; done',
      ], { cwd: root, timeoutMs: this.timeout(deadlineMs, 30_000) })
      if (!started.ok) {
        return [{ id: 'sandbox.container', status: 'failed', message: 'The credential-free command sandbox could not be started.' }]
      }
      const copiedIn = await this.process(['exec', '--user=65534:65534', containerName, '/bin/cp', '-R', '/source/.', '/workspace'], {
        cwd: root, timeoutMs: this.timeout(deadlineMs, 60_000),
      })
      if (!copiedIn.ok) {
        return [{ id: 'sandbox.workspace', status: 'failed', message: 'The bounded repository workspace could not be copied into the command sandbox.' }]
      }

      const temporaryDirectory = await this.process(['exec', '--user=65534:65534', containerName, '/bin/mkdir', '-p', '/workspace/.tmp'], {
        cwd: root, timeoutMs: this.timeout(deadlineMs, 5000),
      })
      if (!temporaryDirectory.ok) return [{ id: 'sandbox.workspace', status: 'failed', message: 'The dependency temporary directory could not be prepared.' }]

      const checks = []
      const commandEnvironment = [
        '--env=HOME=/home/broker',
        '--env=TMPDIR=/workspace/.tmp',
        '--env=XDG_CACHE_HOME=/home/broker/.cache',
        '--env=COREPACK_HOME=/home/broker/.cache/node/corepack',
      ]
      const runCommand = async (name) => {
        if (this.closing) throw new Error('sandbox_stopping')
        const result = await this.process([
          'exec', '--user=65534:65534', '--workdir=/workspace', ...commandEnvironment,
          containerName, '/bin/sh', '-lc', profile.commands[name],
        ], { cwd: root, timeoutMs: this.timeout(deadlineMs, this.commandTimeoutMs) })
        checks.push({
          id: `sandbox.command.${name}`,
          status: result.ok ? 'passed' : 'failed',
          message: result.ok ? `The ${name} command passed in the configured credential-free sandbox.` :
            result.timedOut ? `The ${name} command exceeded the sandbox timeout.` : `The ${name} command failed in the configured credential-free sandbox.`,
        })
        return result.ok
      }

      if (!await runCommand('install')) return checks
      if (this.closing) throw new Error('sandbox_stopping')
      const disconnected = await this.process([
        'network', 'disconnect', 'bridge', containerName,
      ], { cwd: root, timeoutMs: this.timeout(deadlineMs, 10_000) })
      const networkState = disconnected.ok ? await this.process([
        'inspect', '--format', '{{json .NetworkSettings.Networks}}', containerName,
      ], { captureOutput: true, cwd: root, timeoutMs: this.timeout(deadlineMs, 5_000) }) : null
      if (!disconnected.ok || !networkState?.ok || networkState.output.trim() !== '{}') {
        checks.push({
          id: 'sandbox.network',
          status: 'failed',
          message: 'The command sandbox network could not be removed and verified after dependency installation.',
        })
        return checks
      }

      for (const name of ['build', 'test', 'typecheck', 'lint'].filter((entry) => profile.commands[entry])) {
        if (!await runCommand(name)) break
      }
      if (kind === 'static_site') {
        const output = await this.process([
          'exec', '--user=65534:65534', '--workdir=/workspace', containerName,
          'node', '-e', WORKSPACE_INSPECT_SCRIPT, `/workspace/${profile.outputDirectory}`, '10000', String(256 * 1024 * 1024),
        ], { cwd: root, timeoutMs: this.timeout(deadlineMs, 30_000) })
        checks.push({
          id: 'static_site.output',
          status: output.ok ? 'passed' : 'failed',
          message: output.ok ? 'The configured static output directory was produced.' : 'The configured static output directory was not produced.',
        })
      }
      return checks
    } finally {
      if (!await this.cleanupContainer(containerName)) throw this.cleanupError()
    }
  }

  async runQualification({ fullName, baseSha, attemptId, installationToken, profile, kind, deadlineMs }) {
    if (this.closing) throw new Error('sandbox_stopping')
    if (!this.image) {
      return [{ id: 'sandbox.toolchain', status: 'failed', message: 'No digest-pinned qualification image is configured.' }]
    }
    const root = mkdtempSync(join(tmpdir(), 'om-repository-qualification-'))
    const workspace = join(root, 'workspace')
    const askpass = join(root, 'askpass.sh')
    const tokenFile = join(root, 'github-token')
    try {
      mkdirSync(workspace, { mode: 0o700 })
      writeFileSync(tokenFile, installationToken, { mode: 0o600 })
      writeFileSync(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "x-access-token" ;; *) cat "$OM_GITHUB_TOKEN_FILE" ;; esac\n', { mode: 0o700 })
      const checkedOut = await this.checkout({
        root, workspace, askpass, tokenFile, fullName, baseSha, attemptId, deadlineMs,
      })
      if (!checkedOut) return [{ id: 'sandbox.checkout', status: 'failed', message: 'Credential-brokered checkout of the inspected commit failed.' }]
      if (!prepareWorkspace(workspace)) {
        return [{ id: 'sandbox.workspace', status: 'failed', message: 'The repository workspace exceeds the file or byte limit, contains a symlink, or contains a non-file entry.' }]
      }

      return await this.runCommands({ root, workspace, attemptId, profile, kind, deadlineMs })
    } finally {
      if ([...this.activeContainers].every((name) => !name.startsWith(`om-rq-${attemptId}-`))) {
        rmSync(root, { recursive: true, force: true })
      }
    }
  }
}
