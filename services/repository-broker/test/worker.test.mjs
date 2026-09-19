import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { BrokerStore } from '../src/store.mjs'
import { sha256, verifySignedRequest } from '../src/transport.mjs'
import { QualificationWorker } from '../src/worker.mjs'

function request() {
  return {
    installationId: '42', authorizationId: randomUUID(), repositoryId: randomUUID(), githubRepositoryId: '9001',
    baseBranch: 'main', epoch: 1, attemptId: randomUUID(), kind: 'pr_only',
    profile: { version: 1, commands: { install: 'npm ci', build: 'npm run build', test: 'npm test' } },
  }
}

test('a failed callback resumes from the persistent journal after restart', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-worker-test-'))
  const input = request()
  const payload = JSON.stringify(input)
  let nowMs = 1_789_770_000_000
  let callbackCalls = 0
  let store = new BrokerStore(stateDirectory)
  store.claimAttempt(input.attemptId, sha256(payload), payload, Math.floor(nowMs / 1000))
  const result = {
    installationId: '42', repositoryId: input.repositoryId, epoch: 1, attemptId: input.attemptId,
    status: 'failed', report: { checks: [{ id: 'sandbox.toolchain', status: 'failed', message: 'Unavailable.' }] },
  }
  const callbackFetch = async (url, options) => {
    callbackCalls += 1
    const body = Buffer.from(options.body)
    verifySignedRequest({
      method: options.method,
      url,
      headers: options.headers,
      body,
      keys: new Map([['callback-key', 'callback-secret-with-at-least-32-bytes']]),
      nowSeconds: Math.floor(nowMs / 1000),
      claimReplay: () => true,
    })
    assert.deepEqual(JSON.parse(body.toString('utf8')), result)
    return new Response(callbackCalls === 1 ? '' : null, { status: callbackCalls === 1 ? 503 : 204 })
  }
  let worker = new QualificationWorker({
    store, qualify: async () => result, omBaseUrl: 'http://127.0.0.1:5001',
    callbackKeyId: 'callback-key', callbackSecret: 'callback-secret-with-at-least-32-bytes',
    fetchImpl: callbackFetch, now: () => nowMs,
  })
  await worker.tick()
  assert.equal(store.database.prepare('SELECT state FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId).state, 'callback_pending')
  store.close()

  nowMs += 10_000
  store = new BrokerStore(stateDirectory)
  worker = new QualificationWorker({
    store, qualify: async () => { throw new Error('must not rerun completed qualification') },
    omBaseUrl: 'http://127.0.0.1:5001', callbackKeyId: 'callback-key',
    callbackSecret: 'callback-secret-with-at-least-32-bytes', fetchImpl: callbackFetch, now: () => nowMs,
  })
  try {
    await worker.tick()
    assert.equal(callbackCalls, 2)
    assert.equal(store.database.prepare('SELECT state FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId).state, 'delivered')
  } finally {
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('a checking attempt reconciles old containers before provider qualification', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-worker-test-'))
  const input = request()
  const payload = JSON.stringify(input)
  const nowMs = 1_789_770_000_000
  const store = new BrokerStore(stateDirectory)
  store.claimAttempt(input.attemptId, sha256(payload), payload, Math.floor(nowMs / 1000))
  store.markChecking(input.attemptId, Math.floor(nowMs / 1000))
  const order = []
  const worker = new QualificationWorker({
    store,
    reconcile: async (input) => { order.push(`reconcile:${input.attemptId}`) },
    qualify: async (input) => {
      order.push(`qualify:${input.attemptId}`)
      return {
        installationId: input.installationId, repositoryId: input.repositoryId, epoch: input.epoch, attemptId: input.attemptId,
        status: 'failed', report: { checks: [{ id: 'qualification.provider', status: 'failed', message: 'Provider revoked.' }] },
      }
    },
    omBaseUrl: 'http://127.0.0.1:5001', callbackKeyId: 'callback-key',
    callbackSecret: 'callback-secret-with-at-least-32-bytes',
    fetchImpl: async () => new Response(null, { status: 204 }), now: () => nowMs,
  })
  try {
    await worker.tick()
    assert.deepEqual(order, [`reconcile:${input.attemptId}`, `qualify:${input.attemptId}`])
  } finally {
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('a due callback is delivered while a qualification remains blocked', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-worker-test-'))
  const nowMs = 1_789_770_000_000
  const store = new BrokerStore(stateDirectory)
  const callbackInput = request()
  const qualificationInput = request()
  const callbackResult = {
    installationId: callbackInput.installationId, repositoryId: callbackInput.repositoryId,
    epoch: callbackInput.epoch, attemptId: callbackInput.attemptId, status: 'failed', report: { checks: [] },
  }
  for (const input of [qualificationInput, callbackInput]) {
    const payload = JSON.stringify(input)
    store.claimAttempt(input.attemptId, sha256(payload), payload, Math.floor(nowMs / 1000))
  }
  store.saveResult(callbackInput.attemptId, JSON.stringify(callbackResult), Math.floor(nowMs / 1000))
  let releaseQualification
  const qualificationGate = new Promise((resolve) => { releaseQualification = resolve })
  let callbackCalls = 0
  const worker = new QualificationWorker({
    store,
    qualify: async (input) => {
      await qualificationGate
      return { installationId: input.installationId, repositoryId: input.repositoryId, epoch: input.epoch,
        attemptId: input.attemptId, status: 'failed', report: { checks: [] } }
    },
    omBaseUrl: 'http://127.0.0.1:5001', callbackKeyId: 'callback-key',
    callbackSecret: 'callback-secret-with-at-least-32-bytes', now: () => nowMs,
    fetchImpl: async () => { callbackCalls += 1; return new Response(null, { status: 204 }) },
  })
  const tick = worker.tick()
  try {
    for (let index = 0; index < 100 && callbackCalls === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.equal(callbackCalls, 1)
    releaseQualification()
    await tick
  } finally {
    releaseQualification()
    await tick.catch(() => {})
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('an expired checking attempt fails after restart without provider qualification', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-worker-test-'))
  const nowMs = 1_789_770_000_000
  const input = request()
  const payload = JSON.stringify(input)
  let store = new BrokerStore(stateDirectory)
  store.claimAttempt(input.attemptId, sha256(payload), payload, Math.floor(nowMs / 1000) - 841)
  store.markChecking(input.attemptId, Math.floor(nowMs / 1000) - 840)
  store.close()

  store = new BrokerStore(stateDirectory)
  let qualifyCalls = 0
  let reconcileCalls = 0
  const worker = new QualificationWorker({
    store,
    qualify: async () => { qualifyCalls += 1; throw new Error('must not qualify expired attempt') },
    reconcile: async () => { reconcileCalls += 1 },
    omBaseUrl: 'http://127.0.0.1:5001', callbackKeyId: 'callback-key',
    callbackSecret: 'callback-secret-with-at-least-32-bytes', now: () => nowMs,
    fetchImpl: async () => new Response(null, { status: 204 }),
  })
  try {
    await worker.tick()
    assert.equal(qualifyCalls, 0)
    assert.equal(reconcileCalls, 1)
    const row = store.database.prepare('SELECT state, result_json FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId)
    assert.equal(row.state, 'delivered')
    assert.deepEqual(JSON.parse(row.result_json).report.checks, [{
      id: 'qualification.deadline', status: 'failed', message: 'The qualification attempt exceeded its overall deadline.',
    }])
  } finally {
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('callback retries stop at the persisted attempt limit', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-worker-test-'))
  const nowMs = 1_789_770_000_000
  const input = request()
  const payload = JSON.stringify(input)
  const store = new BrokerStore(stateDirectory)
  store.claimAttempt(input.attemptId, sha256(payload), payload, Math.floor(nowMs / 1000))
  store.saveResult(input.attemptId, JSON.stringify({ attemptId: input.attemptId }), Math.floor(nowMs / 1000))
  store.database.prepare('UPDATE qualification_attempts SET callback_attempts = 7 WHERE attempt_id = ?').run(input.attemptId)
  const worker = new QualificationWorker({
    store, qualify: async () => { throw new Error('not reached') }, omBaseUrl: 'http://127.0.0.1:5001',
    callbackKeyId: 'callback-key', callbackSecret: 'callback-secret-with-at-least-32-bytes', now: () => nowMs,
    fetchImpl: async () => new Response('', { status: 503 }),
  })
  try {
    await worker.tick()
    const row = store.database.prepare('SELECT state, callback_attempts FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId)
    assert.equal(row.state, 'callback_failed')
    assert.equal(row.callback_attempts, 8)
  } finally {
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('failed reconciliation remains retryable and never reaches provider qualification', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-worker-test-'))
  const nowMs = 1_789_770_000_000
  const input = request()
  const payload = JSON.stringify(input)
  const store = new BrokerStore(stateDirectory)
  store.claimAttempt(input.attemptId, sha256(payload), payload, Math.floor(nowMs / 1000))
  store.markChecking(input.attemptId, Math.floor(nowMs / 1000))
  let reconcileCalls = 0
  let qualifyCalls = 0
  const worker = new QualificationWorker({
    store,
    reconcile: async () => {
      reconcileCalls += 1
      if (reconcileCalls === 1) throw new Error('docker unavailable')
    },
    qualify: async (requestValue) => {
      qualifyCalls += 1
      return { installationId: requestValue.installationId, repositoryId: requestValue.repositoryId,
        epoch: requestValue.epoch, attemptId: requestValue.attemptId, status: 'failed', report: { checks: [] } }
    },
    omBaseUrl: 'http://127.0.0.1:5001', callbackKeyId: 'callback-key',
    callbackSecret: 'callback-secret-with-at-least-32-bytes', now: () => nowMs,
    fetchImpl: async () => new Response(null, { status: 204 }),
  })
  try {
    await worker.tick()
    const pending = store.database.prepare('SELECT state, result_json FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId)
    assert.equal(pending.state, 'checking')
    assert.equal(pending.result_json, null)
    assert.equal(qualifyCalls, 0)

    await worker.tick()
    assert.equal(reconcileCalls, 2)
    assert.equal(qualifyCalls, 1)
    assert.equal(store.database.prepare('SELECT state FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId).state, 'delivered')
  } finally {
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('initial sandbox cleanup failure remains checking and completes after restart reconciliation', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-worker-test-'))
  const nowMs = 1_789_770_000_000
  const input = request()
  const payload = JSON.stringify(input)
  let store = new BrokerStore(stateDirectory)
  store.claimAttempt(input.attemptId, sha256(payload), payload, Math.floor(nowMs / 1000))
  let qualifyCalls = 0
  let worker = new QualificationWorker({
    store,
    qualify: async () => {
      qualifyCalls += 1
      const error = new Error('sandbox_cleanup_unverified')
      error.code = 'sandbox_cleanup_unverified'
      throw error
    },
    omBaseUrl: 'http://127.0.0.1:5001', callbackKeyId: 'callback-key',
    callbackSecret: 'callback-secret-with-at-least-32-bytes', now: () => nowMs,
    fetchImpl: async () => new Response(null, { status: 204 }),
  })
  await worker.tick()
  assert.equal(store.database.prepare('SELECT state FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId).state, 'checking')
  store.close()

  store = new BrokerStore(stateDirectory)
  let reconcileCalls = 0
  worker = new QualificationWorker({
    store,
    reconcile: async () => { reconcileCalls += 1 },
    qualify: async (requestValue) => {
      qualifyCalls += 1
      return { installationId: requestValue.installationId, repositoryId: requestValue.repositoryId,
        epoch: requestValue.epoch, attemptId: requestValue.attemptId, status: 'failed', report: { checks: [] } }
    },
    omBaseUrl: 'http://127.0.0.1:5001', callbackKeyId: 'callback-key',
    callbackSecret: 'callback-secret-with-at-least-32-bytes', now: () => nowMs,
    fetchImpl: async () => new Response(null, { status: 204 }),
  })
  try {
    await worker.tick()
    assert.equal(reconcileCalls, 1)
    assert.equal(qualifyCalls, 2)
    assert.equal(store.database.prepare('SELECT state FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId).state, 'delivered')
  } finally {
    await worker.stop()
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})

test('worker stop waits for an in-flight callback before the store can close', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'repository-broker-worker-test-'))
  const nowMs = 1_789_770_000_000
  const input = request()
  const payload = JSON.stringify(input)
  const store = new BrokerStore(stateDirectory)
  store.claimAttempt(input.attemptId, sha256(payload), payload, Math.floor(nowMs / 1000))
  store.saveResult(input.attemptId, JSON.stringify({ attemptId: input.attemptId }), Math.floor(nowMs / 1000))
  let releaseCallback
  const callbackGate = new Promise((resolve) => { releaseCallback = resolve })
  let callbackStarted = false
  const worker = new QualificationWorker({
    store, qualify: async () => { throw new Error('not reached') }, omBaseUrl: 'http://127.0.0.1:5001',
    callbackKeyId: 'callback-key', callbackSecret: 'callback-secret-with-at-least-32-bytes', now: () => nowMs,
    fetchImpl: async () => { callbackStarted = true; await callbackGate; return new Response(null, { status: 204 }) },
  })
  const tick = worker.tick()
  for (let index = 0; index < 100 && !callbackStarted; index += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  let stopped = false
  const stopping = Promise.resolve(worker.stop()).then(() => { stopped = true })
  try {
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(stopped, false)
    releaseCallback()
    await stopping
    await tick
    assert.equal(store.database.prepare('SELECT state FROM qualification_attempts WHERE attempt_id = ?').get(input.attemptId).state, 'delivered')
  } finally {
    releaseCallback()
    await Promise.allSettled([tick, stopping])
    store.close()
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})
