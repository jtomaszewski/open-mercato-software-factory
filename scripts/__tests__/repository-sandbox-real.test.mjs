import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { SandboxRunner } from '../../services/repository-broker/src/sandbox.mjs'

const image = process.env.BROKER_TEST_IMAGE
if (!image || !/@sha256:[0-9a-f]{64}$/.test(image)) {
  throw new Error('BROKER_TEST_IMAGE must name a locally available digest-pinned Node image')
}

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 })
}

const limits = [
  '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--memory', '128m',
  '--cpus', '0.5', '--log-driver', 'none', '--user', '65534:65534',
  '--tmpfs', '/workspace:rw,nosuid,nodev,size=16m,nr_inodes=128,mode=1777',
]

test('real public checkout reaches qualification commands', async () => {
  const runner = new SandboxRunner({ image, commandTimeoutMs: 5000 })
  try {
    const checks = await runner.run({
      fullName: 'jtomaszewski/open-mercato-software-factory',
      baseSha: '67a838f75b2cc4eb888ce757f78196ca936a1a16',
      attemptId: randomUUID(), installationToken: 'synthetic-public-smoke', kind: 'pr_only',
      profile: { commands: { install: 'test -f package.json', build: 'test ! -e .git && test ! -e /run/secrets/github-token' } },
    })
    assert.deepEqual(checks.map(({ status }) => status), ['passed', 'passed'])
  } finally { await runner.stop() }
})

test('command workspace can hold this application dependency tree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'om-dependency-capacity-'))
  const workspace = join(root, 'workspace')
  mkdirSync(workspace, { mode: 0o755 })
  const runner = new SandboxRunner({ image, commandTimeoutMs: 5000 })
  try {
    const checks = await runner.runCommands({
      root, workspace, attemptId: randomUUID(), kind: 'pr_only',
      profile: { commands: {
        install: `node -e 'const fs=require("fs"), s=fs.statfsSync("/workspace"), tmp=fs.statfsSync(require("os").tmpdir()); if(s.bsize*s.bavail<2*1024**3 || s.ffree<150000 || tmp.bsize*tmp.bavail<1024**3) process.exit(1)'`,
        build: 'true', test: 'true',
      } },
    })
    assert.deepEqual(checks.map(({ status }) => status), ['passed', 'passed', 'passed'])
  } finally {
    await runner.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('real command sandbox receives source while keeping its root read-only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'om-source-transfer-'))
  const workspace = join(root, 'workspace')
  mkdirSync(workspace, { mode: 0o755 })
  writeFileSync(join(workspace, 'source.txt'), 'synthetic source', { mode: 0o644 })
  const runner = new SandboxRunner({ image, commandTimeoutMs: 5000 })
  try {
    const checks = await runner.runCommands({
      root, workspace, attemptId: randomUUID(), kind: 'pr_only',
      profile: { commands: {
        install: 'test -f source.txt',
        build: 'printf "#!/bin/sh\\nexit 0\\n" > /workspace/native-tool && chmod +x /workspace/native-tool && /workspace/native-tool && test ! -e /run/secrets/github-token',
        test: 'test "$(id -u)" != 0',
      } },
    })
    assert.deepEqual(checks.map(({ status }) => status), ['passed', 'passed', 'passed'])
  } finally {
    await runner.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('real Docker bounds workspace bytes and inodes and denies root writes and networking', () => {
  const name = `om-rq-probe-${randomUUID()}`
  const probe = `
    import fs from 'node:fs';
    import net from 'node:net';
    let byteLimit = false;
    let descriptor;
    try {
      descriptor = fs.openSync('/workspace/large', 'w');
      for (let count = 0; count < 40; count++) fs.writeSync(descriptor, Buffer.alloc(1024 * 1024));
    } catch (error) { byteLimit = error.code === 'ENOSPC'; }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    fs.rmSync('/workspace/large', { force: true });
    let inodeLimit = false;
    try {
      for (let count = 0; count < 300; count++) fs.writeFileSync('/workspace/f' + count, '');
    } catch (error) { inodeLimit = error.code === 'ENOSPC'; }
    let readonly = false;
    try { fs.writeFileSync('/root-write', 'x'); }
    catch (error) { readonly = ['EROFS', 'EACCES'].includes(error.code); }
    const networkBlocked = await new Promise((resolve) => {
      const socket = net.connect({ host: '1.1.1.1', port: 443 });
      socket.setTimeout(2000);
      socket.on('connect', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => resolve(true));
      socket.on('timeout', () => { socket.destroy(); resolve(true); });
    });
    console.log(JSON.stringify({ byteLimit, inodeLimit, readonly, networkBlocked }));
  `
  try {
    const result = docker(['run', '--rm', '--name', name, ...limits, image, 'node', '--input-type=module', '-e', probe])
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    assert.deepEqual(JSON.parse(result.stdout), {
      byteLimit: true, inodeLimit: true, readonly: true, networkBlocked: true,
    })
  } finally {
    docker(['rm', '--force', name])
  }
})

test('a fresh broker sandbox reconciles a real container left by an interrupted attempt', async () => {
  const attemptId = randomUUID()
  const name = `om-rq-${attemptId}-build`
  const runner = new SandboxRunner({ image, commandTimeoutMs: 5000 })
  try {
    const launched = docker(['run', '--detach', '--name', name, ...limits, image, 'node', '-e', 'setInterval(() => {}, 1000)'])
    assert.equal(launched.status, 0, launched.stderr || launched.error?.message)
    assert.equal(docker(['inspect', '--format', '{{.State.Running}}', name]).stdout.trim(), 'true')
    await runner.reconcileAttempt({ attemptId, profile: { commands: { install: 'true', build: 'true', test: 'true' } } })
    const after = docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'])
    assert.equal(after.status, 0, after.stderr)
    assert.equal(after.stdout.trim(), '')
  } finally {
    await runner.stop()
    docker(['rm', '--force', name])
  }
})
