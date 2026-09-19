import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import {
  OmUsabilityClient,
  RepositoryExecutionService,
  validatePullRequestRequest,
  validateSourceRequest,
} from '../src/execution.mjs'
import { verifySignedRequest } from '../src/transport.mjs'

const binding = () => ({
  installationId: '42',
  authorizationId: randomUUID(),
  githubRepositoryId: '9001',
  baseBranch: 'main',
  delegationId: randomUUID(),
  repositoryId: randomUUID(),
  epoch: 3,
  profileDigest: 'a'.repeat(64),
})

test('outbound usability checks use callback HMAC and preserve the frozen binding', async () => {
  const request = binding()
  let received
  const client = new OmUsabilityClient({
    omBaseUrl: 'http://127.0.0.1:5001',
    keyId: 'callback-v1',
    secret: 'callback-secret-with-enough-entropy',
    now: () => 1_789_770_000_000,
    requestId: () => '6dcfe0bd-9f35-4ec4-8abc-94746b0bbccc',
    fetchImpl: async (url, options) => {
      received = { url: new URL(url), options }
      return new Response(JSON.stringify({ usable: true }), { status: 200 })
    },
  })

  await client.assertUsable(request)

  assert.deepEqual(Object.fromEntries(received.url.searchParams), {
    delegationId: request.delegationId,
    repositoryId: request.repositoryId,
    epoch: '3',
    profileDigest: request.profileDigest,
    installationId: request.installationId,
    authorizationId: request.authorizationId,
    githubRepositoryId: request.githubRepositoryId,
    baseBranch: request.baseBranch,
  })
  assert.equal(received.options.redirect, 'error')
  assert.deepEqual(verifySignedRequest({
    method: 'GET', url: received.url, headers: received.options.headers, body: Buffer.alloc(0),
    keys: new Map([['callback-v1', 'callback-secret-with-enough-entropy']]),
    nowSeconds: 1_789_770_000, claimReplay: () => true,
  }), { keyId: 'callback-v1', requestId: '6dcfe0bd-9f35-4ec4-8abc-94746b0bbccc' })
})

test('outbound usability preserves a registry target-tuple refusal', async () => {
  const client = new OmUsabilityClient({
    omBaseUrl: 'http://127.0.0.1:5001', keyId: 'callback-v1', secret: 'callback-secret',
    fetchImpl: async () => new Response(JSON.stringify({ usable: false, reason: 'repository_changed' })),
  })

  await assert.rejects(() => client.assertUsable(binding()), (error) => {
    assert.equal(error.code, 'repository_changed')
    assert.equal(error.statusCode, 409)
    return true
  })
})

test('source export rechecks usability and the immutable consent subset without returning credentials', async () => {
  const request = validateSourceRequest(binding())
  const calls = []
  const service = new RepositoryExecutionService({
    usability: { async assertUsable(value) { calls.push(['usable', value.delegationId]) } },
    github: {
      async getInstallationGrant(installationId, authorizationId) {
        calls.push(['grant', installationId, authorizationId])
        return {
          token: 'must-not-leak', permissions: { metadata: 'read', contents: 'write' },
          repositories: [{ id: '9001', fullName: 'example-org/example', defaultBranch: 'main' }],
        }
      },
      hasPermissions(actual, required) {
        calls.push(['permissions', required])
        return actual.contents === 'write'
      },
      async exportSource(grant, repository, baseBranch) {
        assert.equal(grant.token, 'must-not-leak')
        calls.push(['export', repository.id, baseBranch])
        return { baseSha: 'b'.repeat(40), files: [{ path: 'index.js', mode: '100644', contentBase64: 'YQ==' }] }
      },
    },
  })

  const result = await service.exportSource(request)

  assert.deepEqual(result, {
    baseSha: 'b'.repeat(40), files: [{ path: 'index.js', mode: '100644', contentBase64: 'YQ==' }],
  })
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false)
  assert.deepEqual(calls.map((item) => item[0]), ['usable', 'grant', 'permissions', 'export'])
})

test('a refused registry usability check stops before grant refresh or source access', async () => {
  let githubCalls = 0
  const service = new RepositoryExecutionService({
    usability: { async assertUsable() { throw new Error('repository_changed') } },
    github: {
      async getInstallationGrant() { githubCalls += 1 },
      hasPermissions() { githubCalls += 1 },
      async exportSource() { githubCalls += 1 },
    },
  })

  await assert.rejects(() => service.exportSource(validateSourceRequest(binding())), /repository_changed/)
  assert.equal(githubCalls, 0)
})

test('pull request delivery is canonicalized per delegation and blocks protected paths before GitHub writes', async () => {
  const base = {
    ...binding(), baseSha: 'b'.repeat(40), title: 'Fix the landing page', body: 'Verified locally.',
  }
  const digests = []
  const service = new RepositoryExecutionService({
    usability: { async assertUsable() {} },
    github: {
      async getInstallationGrant() {
        return {
          token: 'must-not-leak', permissions: { metadata: 'read', contents: 'write', pull_requests: 'write' },
          repositories: [{ id: '9001', fullName: 'example-org/example', defaultBranch: 'main' }],
        }
      },
      hasPermissions() { return true },
      async openPullRequest(grant, repository, input) {
        assert.equal(grant.token, 'must-not-leak')
        digests.push(input.operationDigest)
        return { number: 7, url: 'https://github.com/example-org/example/pull/7', headSha: 'c'.repeat(40), branch: input.branch }
      },
    },
  })
  const first = validatePullRequestRequest({
    ...base,
    files: [{ path: 'src/b.js', content: 'b' }, { path: 'src/a.js', content: 'a' }],
  })
  const second = validatePullRequestRequest({
    ...base,
    files: [{ path: 'src/a.js', content: 'a' }, { path: 'src/b.js', content: 'b' }],
  })

  const delivered = await service.openPullRequest(first)
  await service.openPullRequest(second)

  assert.equal(delivered.branch, `open-mercato/delegation-${base.delegationId}`)
  assert.equal(digests[0], digests[1])
  await assert.rejects(
    () => service.openPullRequest(validatePullRequestRequest({
      ...base, files: [{ path: '.github/workflows/ci.yml', content: 'permissions: write-all' }],
    })),
    /protected_path/,
  )
})

test('execution request validators reject extra fields, traversal, duplicates, and malformed bindings', () => {
  assert.throws(() => validateSourceRequest({ ...binding(), token: 'forbidden' }), /invalid_execution_request/)
  assert.throws(() => validateSourceRequest({ ...binding(), profileDigest: 'ABC' }), /invalid_execution_request/)
  assert.throws(() => validatePullRequestRequest({
    ...binding(), baseSha: 'b'.repeat(40), title: 'Title', body: '',
    files: [{ path: '../escape', content: 'x' }],
  }), /invalid_execution_request/)
  assert.throws(() => validatePullRequestRequest({
    ...binding(), baseSha: 'b'.repeat(40), title: 'Title', body: '',
    files: [{ path: 'script.sh', content: '#!/bin/sh\n', mode: '100755' }],
  }), /invalid_execution_request/)
  assert.throws(() => validatePullRequestRequest({
    ...binding(), baseSha: 'b'.repeat(40), title: 'Title', body: '',
    files: [{ path: 'same', content: 'x' }, { path: 'same', content: 'y' }],
  }), /invalid_execution_request/)
})
