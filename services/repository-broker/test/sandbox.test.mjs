import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { SandboxRunner } from '../src/sandbox.mjs'

function sandboxFixture(commandTimeoutMs, { failCommand, failDisconnect = false } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'repository-broker-sandbox-test-'))
  const gitLog = join(fixture, 'git.log')
  const dockerLog = join(fixture, 'docker.log')
  const modeLog = join(fixture, 'mode.log')
  const runningMarker = join(fixture, 'container.running')
  const containersDirectory = join(fixture, 'containers')
  const inspectFailureMarker = join(fixture, 'inspect.fail')
  const gitScript = `#!${process.execPath}\n` +
    `const fs = require('node:fs'); const path = require('node:path');\n` +
    `fs.appendFileSync(${JSON.stringify(gitLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n` +
    `const args = process.argv.slice(2); if (args.includes('init')) fs.mkdirSync(path.join(args.at(-1), '.git'), { recursive: true });\n` +
    `if (args.includes('checkout')) fs.writeFileSync(path.join(args[args.indexOf('-C') + 1], 'script.sh'), '#!/bin/sh\\n', { mode: 0o755 });\n`
  const dockerScript = `#!${process.execPath}\n` +
    `const fs = require('node:fs'); const path = require('node:path'); const args = process.argv.slice(2);\n` +
    `fs.appendFileSync(${JSON.stringify(dockerLog)}, JSON.stringify(args) + '\\n');\n` +
    `if (args[0] === 'info') process.exit(0);\n` +
    `const root = ${JSON.stringify(containersDirectory)}; const marker = (name) => path.join(root, name + '.running'); const network = (name) => path.join(root, name + '.network'); const workspace = (name) => path.join(root, name, 'workspace');\n` +
    `if (args[0] === 'container' && args[1] === 'inspect') process.exit(fs.existsSync(${JSON.stringify(inspectFailureMarker)}) ? 2 : fs.existsSync(marker(args[2])) ? 0 : 1);\n` +
    `if (args[0] === 'ps') { const filter = args[args.indexOf('--filter') + 1] || ''; const match = filter.match(/^name=\\^\\/(.+)\\$$/); if (match && fs.existsSync(marker(match[1]))) process.stdout.write(match[1] + '\\n'); process.exit(0); }\n` +
    `if (args[0] === 'rm') { const name = args.at(-1); fs.rmSync(marker(name), { force: true }); fs.rmSync(network(name), { force: true }); fs.rmSync(path.join(root, name), { recursive: true, force: true }); if (!fs.existsSync(root) || !fs.readdirSync(root).some((entry) => entry.endsWith('.running'))) fs.rmSync(${JSON.stringify(runningMarker)}, { force: true }); process.exit(0); }\n` +
    `if (args[0] === 'run') { const name = args[args.indexOf('--name') + 1]; fs.mkdirSync(workspace(name), { recursive: true }); fs.writeFileSync(marker(name), 'running'); fs.writeFileSync(network(name), 'bridge'); fs.writeFileSync(${JSON.stringify(runningMarker)}, name); process.exit(0); }\n` +
    `if (args[0] === 'network' && args[1] === 'disconnect') { if (${JSON.stringify(failDisconnect)}) process.exit(1); fs.rmSync(network(args[3]), { force: true }); process.exit(0); }\n` +
    `if (args[0] === 'inspect') { const name = args.at(-1); process.stdout.write(fs.existsSync(network(name)) ? '{\"bridge\":{}}\\n' : '{}\\n'); process.exit(0); }\n` +
    `if (args[0] === 'exec') { if (args.includes('/bin/mkdir')) process.exit(0); const name = args.find((item) => item.startsWith('om-rq-')); if (args.includes('/bin/cp')) { const calls = fs.readFileSync(${JSON.stringify(dockerLog)}, 'utf8').trim().split('\\n').map(JSON.parse); const start = calls.find((call) => call[0] === 'run' && call.includes(name)); const mount = start.find((arg) => arg.startsWith('type=bind,src=')); const source = mount.split(',').find((part) => part.startsWith('src=')).slice(4); if (name.endsWith('-checkout')) { for (const entry of fs.readdirSync(workspace(name))) fs.cpSync(path.join(workspace(name), entry), path.join(source, entry), { recursive: true }); process.exit(0); } fs.writeFileSync(${JSON.stringify(modeLog)}, String(fs.statSync(path.join(source, 'script.sh')).mode & 0o777)); for (const entry of fs.readdirSync(source)) fs.cpSync(path.join(source, entry), path.join(workspace(name), entry), { recursive: true }); process.exit(0); } if (name.endsWith('-checkout')) { fs.writeFileSync(path.join(workspace(name), 'script.sh'), '#!/bin/sh\\n', { mode: 0o755 }); process.exit(0); } const command = args[args.indexOf('-lc') + 1]; if (command === ${JSON.stringify(failCommand)}) process.exit(1); if (command === 'never finishes') { setInterval(() => {}, 1000); return; } process.exit(0); }\n` +
    `if (args[0] === 'cp') { const source = args[1]; const destination = args[2]; const containerSource = source.match(/^([^:]+):\\/workspace\\/\\.$/); const containerDestination = destination.match(/^([^:]+):\\/workspace$/); if (containerSource) { for (const entry of fs.readdirSync(workspace(containerSource[1]))) fs.cpSync(path.join(workspace(containerSource[1]), entry), path.join(destination, entry), { recursive: true }); } else if (containerDestination) { const hostSource = source.replace(/\\/\\.$/, ''); fs.writeFileSync(${JSON.stringify(modeLog)}, String(fs.statSync(path.join(hostSource, 'script.sh')).mode & 0o777)); for (const entry of fs.readdirSync(hostSource)) fs.cpSync(path.join(hostSource, entry), path.join(workspace(containerDestination[1]), entry), { recursive: true }); } process.exit(0); }\n` +
    `process.exit(1);\n`
  writeFileSync(join(fixture, 'git'), gitScript, { mode: 0o755 })
  writeFileSync(join(fixture, 'docker'), dockerScript, { mode: 0o755 })
  const runner = new SandboxRunner({
    image: `example.invalid/toolchain@sha256:${'b'.repeat(64)}`,
    commandTimeoutMs,
    executionPath: fixture,
  })
  return { fixture, gitLog, dockerLog, modeLog, runningMarker, containersDirectory, inspectFailureMarker, runner }
}

function qualificationInput(attemptId, baseSha = 'a'.repeat(40)) {
  return {
    fullName: 'example-org/example', baseSha, attemptId, installationToken: 'test-token', kind: 'pr_only',
    profile: { version: 1, commands: { install: 'never finishes', build: 'unused', test: 'unused' } },
  }
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('checkout and timed-out commands use bounded container workspaces with deterministic cleanup', async () => {
  const { fixture, gitLog, dockerLog, modeLog, runningMarker, runner } = sandboxFixture(75)
  const attemptId = randomUUID()
  const baseSha = 'a'.repeat(40)
  try {
    const checks = await runner.run(qualificationInput(attemptId, baseSha))
    assert.equal(checks[0].id, 'sandbox.command.install')
    assert.equal(checks[0].status, 'failed')
    assert.match(checks[0].message, /timeout/, readFileSync(dockerLog, 'utf8'))
    assert.equal(Number(readFileSync(modeLog, 'utf8')), 0o777)
    assert.equal(existsSync(runningMarker), false)
    assert.equal(existsSync(gitLog), false)
    const dockerCalls = readFileSync(dockerLog, 'utf8').trim().split('\n').map(JSON.parse)
    const checkoutName = `om-rq-${attemptId}-checkout`
    const containerName = `om-rq-${attemptId}-commands`
    assert.equal(dockerCalls.some((args) => args.includes('--name') && args.includes(checkoutName) &&
      args.includes('--log-driver=none') && args.some((arg) => arg.startsWith('--tmpfs=/workspace:'))), true)
    assert.equal(dockerCalls.some((args) => args[0] === 'exec' && args.includes(checkoutName) && args.includes(baseSha)), true)
    assert.equal(dockerCalls.some((args) => args.includes('--name') && args.includes(containerName)), true)
    assert.equal(dockerCalls.some((args) => args.includes('--name') && args.includes(containerName) &&
      args.includes('--network=bridge') && args.includes('--log-driver=none') &&
      args.some((arg) => arg.startsWith('--tmpfs=/workspace:')) &&
      !args.some((arg) => arg.includes('type=bind') && arg.includes('dst=/workspace'))), true)
    assert.equal(dockerCalls.some((args) => args[0] === 'rm' && args.includes('--force') && args.includes(checkoutName)), true)
    assert.equal(dockerCalls.some((args) => args[0] === 'rm' && args.includes('--force') && args.includes(containerName)), true)
  } finally {
    await runner.stop()
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('install runs with network before disconnect and later profile commands run without network', async () => {
  const { fixture, dockerLog, runner } = sandboxFixture(1000)
  const attemptId = randomUUID()
  const input = qualificationInput(attemptId)
  input.profile.commands = {
    install: 'corepack yarn install', build: 'corepack yarn build', test: 'corepack yarn test',
    typecheck: 'corepack yarn typecheck', lint: 'corepack yarn lint',
  }
  try {
    const checks = await runner.run(input)
    assert.deepEqual(checks.map(({ id, status }) => ({ id, status })), [
      { id: 'sandbox.command.install', status: 'passed' },
      { id: 'sandbox.command.build', status: 'passed' },
      { id: 'sandbox.command.test', status: 'passed' },
      { id: 'sandbox.command.typecheck', status: 'passed' },
      { id: 'sandbox.command.lint', status: 'passed' },
    ])
    const calls = readFileSync(dockerLog, 'utf8').trim().split('\n').map(JSON.parse)
    const containerName = `om-rq-${attemptId}-commands`
    const commandIndex = (command) => calls.findIndex((args) => args[0] === 'exec' && args.includes(containerName) && args.at(-1) === command)
    const disconnectIndex = calls.findIndex((args) => args[0] === 'network' && args[1] === 'disconnect' && args[3] === containerName)
    const inspectIndex = calls.findIndex((args) => args[0] === 'inspect' && args.at(-1) === containerName)
    assert.ok(commandIndex('corepack yarn install') < disconnectIndex)
    assert.ok(disconnectIndex < inspectIndex)
    assert.ok(inspectIndex < commandIndex('corepack yarn build'))
    assert.ok(commandIndex('corepack yarn build') < commandIndex('corepack yarn test'))
    const start = calls.find((args) => args[0] === 'run' && args.includes(containerName))
    assert.equal(start.includes('--network=bridge'), true)
    assert.equal(start.some((arg) => arg.startsWith('--tmpfs=/home/broker:')), true)
    for (const variable of [
      '--env=HOME=/home/broker',
      '--env=XDG_CACHE_HOME=/home/broker/.cache',
      '--env=COREPACK_HOME=/home/broker/.cache/node/corepack',
    ]) {
      assert.equal(calls.filter((args) => args[0] === 'exec' && args.includes(containerName) && args.includes('/bin/sh')).every((args) => args.includes(variable)), true)
    }
  } finally {
    await runner.stop()
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('a failed install stops before network disconnect and later profile commands', async () => {
  const { fixture, dockerLog, runner } = sandboxFixture(1000, { failCommand: 'install fails' })
  const input = qualificationInput(randomUUID())
  input.profile.commands = { install: 'install fails', build: 'must not build', test: 'must not test' }
  try {
    const checks = await runner.run(input)
    assert.deepEqual(checks.map(({ id, status }) => ({ id, status })), [
      { id: 'sandbox.command.install', status: 'failed' },
    ])
    const calls = readFileSync(dockerLog, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(calls.some((args) => args[0] === 'network' && args[1] === 'disconnect'), false)
    assert.equal(calls.some((args) => args.includes('must not build') || args.includes('must not test')), false)
  } finally {
    await runner.stop()
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('a failed build after network removal stops before later profile commands', async () => {
  const { fixture, dockerLog, runner } = sandboxFixture(1000, { failCommand: 'build fails' })
  const input = qualificationInput(randomUUID())
  input.profile.commands = { install: 'install passes', build: 'build fails', test: 'must not test' }
  try {
    const checks = await runner.run(input)
    assert.deepEqual(checks.map(({ id, status }) => ({ id, status })), [
      { id: 'sandbox.command.install', status: 'passed' },
      { id: 'sandbox.command.build', status: 'failed' },
    ])
    const calls = readFileSync(dockerLog, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(calls.some((args) => args[0] === 'network' && args[1] === 'disconnect'), true)
    assert.equal(calls.some((args) => args.includes('must not test')), false)
  } finally {
    await runner.stop()
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('a failed network disconnect stops before build and test', async () => {
  const { fixture, dockerLog, runner } = sandboxFixture(1000, { failDisconnect: true })
  const input = qualificationInput(randomUUID())
  input.profile.commands = { install: 'install passes', build: 'must not build', test: 'must not test' }
  try {
    const checks = await runner.run(input)
    assert.deepEqual(checks.map(({ id, status }) => ({ id, status })), [
      { id: 'sandbox.command.install', status: 'passed' },
      { id: 'sandbox.network', status: 'failed' },
    ])
    const calls = readFileSync(dockerLog, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(calls.some((args) => args.includes('must not build') || args.includes('must not test')), false)
  } finally {
    await runner.stop()
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('shutdown kills the client, removes the active container, and waits for the run', async () => {
  const { fixture, runningMarker, runner } = sandboxFixture(30_000)
  const attemptId = randomUUID()
  try {
    const run = runner.run(qualificationInput(attemptId))
    await waitFor(() => existsSync(runningMarker) && readFileSync(runningMarker, 'utf8') === `om-rq-${attemptId}-commands`)
    assert.equal(await runner.stop(), true)
    const checks = await run
    assert.equal(checks[0].status, 'failed')
    assert.equal(existsSync(runningMarker), false)
    assert.equal(runner.activeProcesses.size, 0)
    assert.equal(runner.activeContainers.size, 0)
  } finally {
    await runner.stop()
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('failed inspect requires positive name inventory before absence is accepted', async () => {
  const { fixture, containersDirectory, inspectFailureMarker, runner } = sandboxFixture(1000)
  const name = `om-rq-${randomUUID()}-commands`
  mkdirSync(containersDirectory, { recursive: true })
  writeFileSync(join(containersDirectory, `${name}.running`), 'running')
  writeFileSync(inspectFailureMarker, 'fail inspect')
  runner.activeContainers.add(name)
  try {
    assert.equal(await runner.cleanupContainer(name), true)
    assert.equal(existsSync(join(containersDirectory, `${name}.running`)), false)
    assert.equal(runner.activeContainers.has(name), false)
  } finally {
    await runner.stop()
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('real checkout container provisions owner-only synthetic askpass credentials for UID 65534', {
  skip: !process.env.BROKER_TEST_IMAGE,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'repository-broker-real-credential-test-'))
  const workspace = join(root, 'workspace')
  const askpass = join(root, 'askpass.sh')
  const tokenFile = join(root, 'github-token')
  const attemptId = randomUUID()
  const containerName = `om-rq-${attemptId}-checkout`
  const runner = new SandboxRunner({ image: process.env.BROKER_TEST_IMAGE, commandTimeoutMs: 1000 })
  mkdirSync(workspace, { mode: 0o700 })
  writeFileSync(tokenFile, 'synthetic-token-value', { mode: 0o600 })
  writeFileSync(askpass, '#!/bin/sh\ncat "$OM_GITHUB_TOKEN_FILE"\n', { mode: 0o700 })
  try {
    assert.equal(statSync(tokenFile).mode & 0o777, 0o600)
    assert.equal(statSync(askpass).mode & 0o777, 0o700)
    const started = await runner.startCheckoutContainer({ root, askpass, tokenFile, attemptId })
    assert.equal(started.ok, true)
    const invoked = await runner.process([
      'exec', '--user=65534:65534', '--env=OM_GITHUB_TOKEN_FILE=/run/secrets/github-token',
      containerName, '/run/secrets/askpass', 'Password',
    ], { captureOutput: true, cwd: root, timeoutMs: 5000 })
    assert.equal(invoked.ok, true, invoked.output)
    assert.equal(invoked.output, 'synthetic-token-value')
    const modes = await runner.process([
      'exec', '--user=65534:65534', containerName, 'node', '-e',
      "const fs=require('node:fs'); for (const path of process.argv.slice(1)) { const value=fs.statSync(path); console.log([value.uid,value.gid,value.mode & 0o777].join(':')) }",
      '/run/secrets/github-token', '/run/secrets/askpass',
    ], { captureOutput: true, cwd: root, timeoutMs: 5000 })
    assert.equal(modes.ok, true, modes.output)
    assert.equal(modes.output, '65534:65534:384\n65534:65534:448\n')
    const gitWorkspace = await runner.process([
      'exec', '--user=65534:65534', '--env=GIT_CONFIG_NOSYSTEM=1', '--env=GIT_CONFIG_GLOBAL=/dev/null',
      containerName, '/bin/sh', '-c', 'git init /workspace && git -C /workspace status --porcelain',
    ], { captureOutput: true, cwd: root, timeoutMs: 5000 })
    assert.equal(gitWorkspace.ok, true, gitWorkspace.output)
  } finally {
    await runner.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
