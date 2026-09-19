import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'

import { GitHubClient } from '../src/github.mjs'

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

test('OAuth consent includes only user-writable repositories also present in the App grant', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url === 'https://github.com/login/oauth/access_token') return jsonResponse({ access_token: 'short-user-token' })
    if (url.startsWith('https://api.github.com/user/installations/42/repositories')) {
      return jsonResponse({ repositories: [
        { id: 9001, permissions: { push: true, admin: false } },
        { id: 9002, permissions: { push: false, admin: false } },
        { id: 9003, permissions: { push: false, admin: true } },
        { id: 9999, permissions: { push: true, admin: false } },
      ] })
    }
    if (url === 'https://api.github.com/app/installations/42') return jsonResponse({ id: 42, account: { login: 'example-org' } })
    if (url === 'https://api.github.com/app/installations/42/access_tokens') {
      return jsonResponse({ token: 'short-installation-token', permissions: { contents: 'write' } })
    }
    if (url.startsWith('https://api.github.com/installation/repositories')) {
      return jsonResponse({ repositories: [
        { id: 9001, full_name: 'example-org/example', default_branch: 'main' },
        { id: 9002, full_name: 'example-org/read-only', default_branch: 'main' },
        { id: 9003, full_name: 'example-org/admin', default_branch: 'trunk' },
      ] })
    }
    throw new Error(`unexpected URL: ${url}`)
  }
  const client = new GitHubClient({
    appId: '123', clientId: 'client-id', clientSecret: 'client-secret',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), fetchImpl,
    now: () => 1_789_770_000_000,
  })

  const grant = await client.verifyInstallationConsent('42', 'one-use-code')
  assert.equal(grant.accountLogin, 'example-org')
  assert.deepEqual(grant.repositories.map((item) => item.id), ['9001', '9003'])
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(calls[1].options.headers.authorization, 'Bearer short-user-token')
  assert.match(calls[2].options.headers.authorization, /^Bearer ey/)
  assert.equal(calls.some(({ options }) => options.headers.authorization === 'Bearer short-installation-token'), true)
})

test('OAuth consent mismatch stops before installation token issuance', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const urls = []
  const client = new GitHubClient({
    appId: '123', clientId: 'client-id', clientSecret: 'client-secret',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fetchImpl: async (url) => {
      urls.push(url)
      if (url === 'https://github.com/login/oauth/access_token') return jsonResponse({ access_token: 'short-user-token' })
      return jsonResponse({}, 404)
    },
  })
  await assert.rejects(() => client.verifyInstallationConsent('42', 'one-use-code'), /installation_consent_mismatch/)
  assert.equal(urls.some((url) => url.includes('/access_tokens')), false)
})

test('repository inspection resolves only the exact base branch SHA', async () => {
  const urls = []
  const client = new GitHubClient({
    appId: '123', clientId: 'client-id', clientSecret: 'client-secret', privateKey: 'unused',
    fetchImpl: async (url) => {
      urls.push(url)
      return jsonResponse({ commit: { sha: 'a'.repeat(40) } })
    },
  })

  const result = await client.inspectRepository(
    { token: 'installation-token' },
    { id: '9001', fullName: 'example-org/example', defaultBranch: 'main' },
    'feature/qualified branch',
  )

  assert.deepEqual(result, { branchSha: 'a'.repeat(40) })
  assert.deepEqual(urls, [
    'https://api.github.com/repos/example-org/example/branches/feature%2Fqualified%20branch',
  ])
})

test('source export returns a bounded exact-commit file tree and rejects links', async () => {
  const baseSha = 'a'.repeat(40)
  const treeSha = 'b'.repeat(40)
  const blobSha = 'c'.repeat(40)
  const urls = []
  const client = new GitHubClient({
    appId: '123', clientId: 'client-id', clientSecret: 'client-secret', privateKey: 'unused',
    fetchImpl: async (url) => {
      urls.push(url)
      if (url.endsWith('/branches/main')) return jsonResponse({ commit: { sha: baseSha } })
      if (url.endsWith(`/git/commits/${baseSha}`)) return jsonResponse({ tree: { sha: treeSha } })
      if (url.endsWith(`/git/trees/${treeSha}?recursive=1`)) return jsonResponse({ truncated: false, tree: [
        { path: 'src', mode: '040000', type: 'tree', sha: 'd'.repeat(40) },
        { path: 'src/index.js', mode: '100755', type: 'blob', sha: blobSha },
      ] })
      if (url.endsWith(`/git/blobs/${blobSha}`)) return jsonResponse({ encoding: 'base64', content: 'Y29uc29sZS5sb2coMSkK' })
      throw new Error(`unexpected URL: ${url}`)
    },
  })

  const result = await client.exportSource(
    { token: 'installation-token' },
    { id: '9001', fullName: 'example-org/example', defaultBranch: 'main' },
    'main',
  )

  assert.deepEqual(result, {
    baseSha,
    files: [{ path: 'src/index.js', mode: '100755', contentBase64: 'Y29uc29sZS5sb2coMSkK' }],
  })
  assert.equal(urls.length, 4)

  const linked = new GitHubClient({
    appId: '123', clientId: 'client-id', clientSecret: 'client-secret', privateKey: 'unused',
    fetchImpl: async (url) => {
      if (url.endsWith('/branches/main')) return jsonResponse({ commit: { sha: baseSha } })
      if (url.endsWith(`/git/commits/${baseSha}`)) return jsonResponse({ tree: { sha: treeSha } })
      return jsonResponse({ truncated: false, tree: [
        { path: 'escape', mode: '120000', type: 'blob', sha: blobSha },
      ] })
    },
  })
  await assert.rejects(
    () => linked.exportSource(
      { token: 'installation-token' },
      { id: '9001', fullName: 'example-org/example', defaultBranch: 'main' },
      'main',
    ),
    /github_unsafe_tree/,
  )
})

test('pull request creation preserves executable mode, defaults new text files, and reconciles retries', async () => {
  const baseSha = 'a'.repeat(40)
  const baseTreeSha = 'b'.repeat(40)
  const blobSha = 'c'.repeat(40)
  const treeSha = 'd'.repeat(40)
  const headSha = 'e'.repeat(40)
  const operationDigest = 'f'.repeat(64)
  const delegationId = '6dcfe0bd-9f35-4ec4-8abc-94746b0bbccc'
  const branch = `open-mercato/delegation-${delegationId}`
  const calls = []
  let branchExists = false
  let pullRequestExists = false
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url)
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ method: options.method, pathname: parsed.pathname, search: parsed.search, body })
    if (parsed.pathname.endsWith(`/git/ref/heads/${encodeURIComponent(branch)}`)) {
      return branchExists ? jsonResponse({ object: { sha: headSha } }) : jsonResponse({}, 404)
    }
    if (parsed.pathname.endsWith('/branches/main')) return jsonResponse({ commit: { sha: baseSha } })
    if (parsed.pathname.endsWith(`/git/commits/${baseSha}`)) return jsonResponse({ tree: { sha: baseTreeSha } })
    if (parsed.pathname.endsWith(`/git/trees/${baseTreeSha}`)) return jsonResponse({ truncated: false, tree: [
      { path: 'src/index.js', mode: '100755', type: 'blob', sha: '1'.repeat(40) },
    ] })
    if (parsed.pathname.endsWith('/git/blobs')) return jsonResponse({ sha: blobSha })
    if (parsed.pathname.endsWith('/git/trees')) return jsonResponse({ sha: treeSha })
    if (parsed.pathname.endsWith('/git/commits') && options.method === 'POST') return jsonResponse({ sha: headSha })
    if (parsed.pathname.endsWith('/git/refs')) { branchExists = true; return jsonResponse({ object: { sha: headSha } }) }
    if (parsed.pathname.endsWith(`/git/commits/${headSha}`)) {
      return jsonResponse({ message: `Fix\n\nOpen-Mercato-Operation: ${operationDigest}`, parents: [{ sha: baseSha }] })
    }
    if (parsed.pathname.endsWith('/pulls') && options.method === 'GET') {
      return jsonResponse(pullRequestExists ? [{
        number: 7, html_url: 'https://github.com/example-org/example/pull/7',
        head: { sha: headSha }, base: { ref: 'main' },
      }] : [])
    }
    if (parsed.pathname.endsWith('/pulls') && options.method === 'POST') {
      pullRequestExists = true
      return jsonResponse({ number: 7, html_url: 'https://github.com/example-org/example/pull/7', head: { sha: headSha } })
    }
    throw new Error(`unexpected URL: ${url}`)
  }
  const client = new GitHubClient({
    appId: '123', clientId: 'client-id', clientSecret: 'client-secret', privateKey: 'unused', fetchImpl,
  })
  const grant = { token: 'installation-token' }
  const repository = { id: '9001', fullName: 'example-org/example', defaultBranch: 'main' }
  const input = {
    baseBranch: 'main', baseSha, title: 'Fix', body: 'Body', branch, operationDigest,
    files: [
      { path: 'src/index.js', content: 'console.log(1)\n' },
      { path: 'src/new.js', content: 'console.log(2)\n' },
    ],
  }

  const created = await client.openPullRequest(grant, repository, input)
  const writesAfterCreate = calls.filter((call) => call.method === 'POST').length
  const retried = await client.openPullRequest(grant, repository, input)

  assert.deepEqual(created, {
    number: 7, url: 'https://github.com/example-org/example/pull/7', headSha, branch,
  })
  assert.deepEqual(retried, created)
  assert.equal(calls.filter((call) => call.method === 'POST').length, writesAfterCreate)
  assert.equal(calls.some((call) => call.method === 'PATCH'), false)
  assert.deepEqual(calls.find((call) => call.pathname.endsWith('/git/blobs')).body, {
    content: Buffer.from('console.log(1)\n').toString('base64'), encoding: 'base64',
  })
  assert.deepEqual(calls.find((call) => call.pathname.endsWith('/git/trees')).body, {
    base_tree: baseTreeSha,
    tree: [
      { path: 'src/index.js', mode: '100755', type: 'blob', sha: blobSha },
      { path: 'src/new.js', mode: '100644', type: 'blob', sha: blobSha },
    ],
  })
  assert.deepEqual(calls.find((call) => call.pathname.endsWith('/git/refs')).body, {
    ref: `refs/heads/${branch}`, sha: headSha,
  })
  const writesBeforeConflict = calls.filter((call) => call.method === 'POST').length
  await assert.rejects(
    () => client.openPullRequest(grant, repository, { ...input, operationDigest: '0'.repeat(64) }),
    /github_branch_conflict/,
  )
  assert.equal(calls.filter((call) => call.method === 'POST').length, writesBeforeConflict)
  assert.equal(calls.some((call) => call.method === 'PATCH'), false)
})

test('pull request creation rejects truncated and unsupported existing tree entries before writes', async (context) => {
  const baseSha = 'a'.repeat(40)
  const baseTreeSha = 'b'.repeat(40)
  const cases = [
    {
      name: 'truncated tree', path: 'new.txt', code: 'github_tree_unavailable',
      tree: { truncated: true, tree: [] },
    },
    {
      name: 'symlink mode', path: 'script.sh', code: 'github_unsafe_tree',
      tree: { truncated: false, tree: [{ path: 'script.sh', mode: '120000', type: 'blob', sha: 'c'.repeat(40) }] },
    },
    {
      name: 'tree object', path: 'src', code: 'github_unsafe_tree',
      tree: { truncated: false, tree: [{ path: 'src', mode: '040000', type: 'tree', sha: 'd'.repeat(40) }] },
    },
  ]

  for (const item of cases) {
    await context.test(item.name, async () => {
      const calls = []
      const client = new GitHubClient({
        appId: '123', clientId: 'client-id', clientSecret: 'client-secret', privateKey: 'unused',
        fetchImpl: async (url, options) => {
          const parsed = new URL(url)
          calls.push({ method: options.method, pathname: parsed.pathname })
          if (parsed.pathname.includes('/git/ref/heads/')) return jsonResponse({}, 404)
          if (parsed.pathname.endsWith('/branches/main')) return jsonResponse({ commit: { sha: baseSha } })
          if (parsed.pathname.endsWith(`/git/commits/${baseSha}`)) return jsonResponse({ tree: { sha: baseTreeSha } })
          if (parsed.pathname.endsWith(`/git/trees/${baseTreeSha}`)) return jsonResponse(item.tree)
          throw new Error(`unexpected URL: ${url}`)
        },
      })

      await assert.rejects(
        () => client.openPullRequest(
          { token: 'installation-token' },
          { id: '9001', fullName: 'example-org/example', defaultBranch: 'main' },
          {
            baseBranch: 'main', baseSha, title: 'Fix', body: 'Body',
            branch: 'open-mercato/delegation-test', operationDigest: 'f'.repeat(64),
            files: [{ path: item.path, content: 'replacement' }],
          },
        ),
        new RegExp(item.code),
      )
      assert.equal(calls.some((call) => call.method === 'POST'), false)
    })
  }
})

test('a provider deadline expires before any GitHub request starts', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  let calls = 0
  const client = new GitHubClient({
    appId: '123', clientId: 'client-id', clientSecret: 'client-secret',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fetchImpl: async () => { calls += 1; return jsonResponse({}) },
    now: () => 1_789_770_000_000,
  })
  await assert.rejects(
    () => client.getInstallationGrant('42', { deadlineMs: 1_789_769_999_999 }),
    /qualification_deadline_exceeded/,
  )
  assert.equal(calls, 0)
})
