import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { createBrokerServer } from '../src/server.mjs'
import { BrokerStore } from '../src/store.mjs'
import { signedHeaders } from '../src/transport.mjs'

const NOW_MS = 1_789_770_000_000
const KEY_ID = 'local-key'
const SECRET = 'request-secret-with-enough-entropy'

async function startBroker(stateDirectory, github, worker = { wake() {} }, execution) {
  const store = new BrokerStore(stateDirectory)
  const server = createBrokerServer({
    requestKeys: new Map([[KEY_ID, SECRET]]), store, github, worker, execution, now: () => NOW_MS,
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    store,
    server,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      store.close()
    },
  }
}

async function brokerRequest(origin, path, { method = 'GET', value, requestId = randomUUID() } = {}) {
  const url = new URL(path, origin)
  const body = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value))
  const timestamp = String(Math.floor(NOW_MS / 1000))
  return fetch(url, {
    method,
    body: method === 'GET' ? undefined : body,
    headers: signedHeaders({ method, url, body, keyId: KEY_ID, secret: SECRET, timestamp, requestId }),
  })
}

test('branch reads require authorization and a replay remains rejected after restart', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-test-'))
  const requestId = randomUUID()
  const authorizationId = randomUUID()
  const github = { async listBranches(installationId, receivedAuthorizationId, repositoryId) {
    assert.equal(installationId, '42')
    assert.equal(receivedAuthorizationId, authorizationId)
    assert.equal(repositoryId, '9001')
    return ['main', 'release']
  } }
  let broker = await startBroker(stateDirectory, github)
  try {
    const first = await brokerRequest(broker.origin, `/repositories/9001/branches?installationId=42&authorizationId=${authorizationId}`, { requestId })
    assert.equal(first.status, 200)
    assert.deepEqual(await first.json(), { branches: ['main', 'release'] })
    const replay = await brokerRequest(broker.origin, `/repositories/9001/branches?installationId=42&authorizationId=${authorizationId}`, { requestId })
    assert.equal(replay.status, 409)
    assert.deepEqual(await replay.json(), { error: 'request_replayed' })
  } finally {
    await broker.close()
  }

  broker = await startBroker(stateDirectory, github)
  try {
    const replayAfterRestart = await brokerRequest(broker.origin, `/repositories/9001/branches?installationId=42&authorizationId=${authorizationId}`, { requestId })
    assert.equal(replayAfterRestart.status, 409)
  } finally {
    await broker.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('installation verification returns only public grant fields', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-test-'))
  const broker = await startBroker(stateDirectory, {
    async verifyInstallationConsent(installationId, code) {
      assert.equal(installationId, '42')
      assert.equal(code, 'one-use-oauth-code')
      return {
        installationId: '42', authorizationId: 'f5f487b6-52d7-44df-8fae-bda4450e34bb', accountLogin: 'example-org', token: 'must-not-leak', permissions: { contents: 'write' },
        repositories: [{ id: '9001', fullName: 'example-org/example', defaultBranch: 'main' }],
      }
    },
  })
  try {
    const response = await brokerRequest(broker.origin, '/installations/verify', {
      method: 'POST', value: { installationId: '42', code: 'one-use-oauth-code' },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      installationId: '42', accountLogin: 'example-org',
      authorizationId: 'f5f487b6-52d7-44df-8fae-bda4450e34bb',
      repositories: [{ id: '9001', fullName: 'example-org/example', defaultBranch: 'main' }],
    })
  } finally {
    await broker.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('qualification acceptance is durable and attempt payloads are immutable', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-test-'))
  let wakeCount = 0
  const broker = await startBroker(stateDirectory, {}, { wake() { wakeCount += 1 } })
  const attemptId = randomUUID()
  const payload = {
    installationId: '42',
    authorizationId: randomUUID(),
    repositoryId: randomUUID(),
    githubRepositoryId: '9001',
    baseBranch: 'main',
    epoch: 1,
    attemptId,
    kind: 'pr_only',
    profile: { version: 1, commands: { install: 'npm ci', build: 'npm run build', test: 'npm test' } },
  }
  try {
    const first = await brokerRequest(broker.origin, '/qualifications', { method: 'POST', value: payload })
    assert.equal(first.status, 202)
    assert.deepEqual(await first.json(), { accepted: true, attemptId })
    const duplicate = await brokerRequest(broker.origin, '/qualifications', { method: 'POST', value: payload })
    assert.equal(duplicate.status, 202)
    assert.equal(wakeCount, 1)
    const reordered = await brokerRequest(broker.origin, '/qualifications', {
      method: 'POST', value: { ...payload, profile: {
        commands: { test: 'npm test', build: 'npm run build', install: 'npm ci' }, version: 1,
      } },
    })
    assert.equal(reordered.status, 202)
    assert.equal(wakeCount, 1)
    const conflict = await brokerRequest(broker.origin, '/qualifications', {
      method: 'POST', value: { ...payload, baseBranch: 'release' },
    })
    assert.equal(conflict.status, 409)
    assert.deepEqual(await conflict.json(), { error: 'attempt_payload_conflict' })
  } finally {
    await broker.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('execution routes expose bounded source files and pull request identity without credentials', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-test-'))
  const binding = {
    installationId: '42', authorizationId: randomUUID(), githubRepositoryId: '9001', baseBranch: 'main',
    delegationId: randomUUID(), repositoryId: randomUUID(), epoch: 3, profileDigest: 'a'.repeat(64),
  }
  const received = []
  const execution = {
    async exportSource(input) {
      received.push(['source', input])
      return { baseSha: 'b'.repeat(40), files: [{ path: 'index.js', mode: '100644', contentBase64: 'YQ==' }] }
    },
    async openPullRequest(input) {
      received.push(['pull-request', input])
      return {
        number: 7, url: 'https://github.com/example-org/example/pull/7',
        headSha: 'c'.repeat(40), branch: `open-mercato/delegation-${binding.delegationId}`,
      }
    },
  }
  const broker = await startBroker(stateDirectory, {}, { wake() {} }, execution)
  try {
    const source = await brokerRequest(broker.origin, '/executions/source', { method: 'POST', value: binding })
    assert.equal(source.status, 200)
    assert.deepEqual(await source.json(), {
      baseSha: 'b'.repeat(40), files: [{ path: 'index.js', mode: '100644', contentBase64: 'YQ==' }],
    })

    const pullRequestInput = {
      ...binding, baseSha: 'b'.repeat(40), title: 'Fix', body: 'Body',
      files: [{ path: 'index.js', content: 'changed' }],
    }
    const pullRequest = await brokerRequest(broker.origin, '/executions/pull-requests', {
      method: 'POST', value: pullRequestInput,
    })
    assert.equal(pullRequest.status, 200)
    assert.deepEqual(await pullRequest.json(), {
      number: 7, url: 'https://github.com/example-org/example/pull/7',
      headSha: 'c'.repeat(40), branch: `open-mercato/delegation-${binding.delegationId}`,
    })
    assert.deepEqual(received, [['source', binding], ['pull-request', pullRequestInput]])
    assert.equal(JSON.stringify(received).includes('token'), false)
  } finally {
    await broker.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})
