import { createSign } from 'node:crypto'

const API_ORIGIN = 'https://api.github.com'
const WEB_ORIGIN = 'https://github.com'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const PERMISSION_LEVEL = { none: 0, read: 1, write: 2 }
const SHA_PATTERN = /^[0-9a-f]{40}$/
const MAX_SOURCE_FILES = 5000
const MAX_SOURCE_BLOB_BYTES = 1024 * 1024
const MAX_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_SOURCE_RESPONSE_BYTES = 48 * 1024 * 1024

export class GitHubError extends Error {
  constructor(code, statusCode = 502) {
    super(code)
    this.name = 'GitHubError'
    this.code = code
    this.statusCode = statusCode
  }
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function appJwt(appId, privateKey, nowSeconds) {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }))
  const unsigned = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  return `${unsigned}.${signer.sign(privateKey, 'base64url')}`
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new GitHubError('github_response_too_large')
  const chunks = []
  let total = 0
  for await (const chunk of response.body || []) {
    total += chunk.length
    if (total > MAX_RESPONSE_BYTES) throw new GitHubError('github_response_too_large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new GitHubError('github_invalid_response')
  }
}

function repository(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1 || typeof value.full_name !== 'string' ||
      typeof value.default_branch !== 'string' || value.default_branch.length < 1 || value.default_branch.length > 255 ||
      /[\x00-\x1f\x7f]/.test(value.default_branch) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.full_name)) {
    throw new GitHubError('github_invalid_response')
  }
  return { id: String(value.id), fullName: value.full_name, defaultBranch: value.default_branch }
}

function safeTreePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500 || value.startsWith('/') ||
      Buffer.byteLength(value) > 500 || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) return false
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && segment.toLowerCase() !== '.git')
}

export class GitHubClient {
  constructor({ appId, clientId, clientSecret, privateKey, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
    this.appId = appId
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.privateKey = privateKey
    this.fetchImpl = fetchImpl
    this.now = now
    this.sleep = sleep
  }

  timeout(deadlineMs, maximumMs = 15_000) {
    if (deadlineMs === undefined) return maximumMs
    const remainingMs = Math.floor(deadlineMs - this.now())
    if (remainingMs <= 0) throw new GitHubError('qualification_deadline_exceeded', 504)
    return Math.min(maximumMs, remainingMs)
  }

  async request(url, { method = 'GET', token, body, retry = true, deadlineMs } = {}) {
    if (!(url.startsWith(`${API_ORIGIN}/`) || url === `${WEB_ORIGIN}/login/oauth/access_token`)) {
      throw new GitHubError('github_origin_refused')
    }
    for (let attempt = 0; attempt < (retry ? 3 : 1); attempt += 1) {
      let response
      const timeoutMs = this.timeout(deadlineMs)
      try {
        response = await this.fetchImpl(url, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
            'user-agent': 'open-mercato-repository-broker/0.1',
            'x-github-api-version': '2022-11-28',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      } catch {
        if (deadlineMs !== undefined && this.now() >= deadlineMs) {
          throw new GitHubError('qualification_deadline_exceeded', 504)
        }
        if (attempt < 2 && retry) {
          const delay = (100 * (2 ** attempt)) + Math.floor(Math.random() * 100)
          await this.sleep(Math.min(delay, this.timeout(deadlineMs, delay)))
          continue
        }
        throw new GitHubError('github_unavailable', 503)
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2 && retry) {
        if (response.body) await response.body.cancel().catch(() => {})
        const retryAfter = Number(response.headers.get('retry-after'))
        const delay = Number.isFinite(retryAfter) ? Math.min(10_000, Math.max(0, retryAfter * 1000)) : (100 * (2 ** attempt)) + Math.floor(Math.random() * 100)
        await this.sleep(Math.min(delay, this.timeout(deadlineMs, delay)))
        continue
      }
      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => {})
        if (response.status === 404) throw new GitHubError('github_not_found', 404)
        if (response.status === 409 || response.status === 422) throw new GitHubError('github_conflict', 409)
        throw new GitHubError('github_request_failed', 502)
      }
      return readBoundedJson(response)
    }
    throw new GitHubError('github_unavailable', 503)
  }

  async exchangeOAuthCode(code, options = {}) {
    const result = await this.request(`${WEB_ORIGIN}/login/oauth/access_token`, {
      method: 'POST',
      retry: false,
      deadlineMs: options.deadlineMs,
      body: { client_id: this.clientId, client_secret: this.clientSecret, code },
    })
    if (!result || typeof result.access_token !== 'string' || result.access_token.length === 0) {
      throw new GitHubError('github_oauth_refused', 403)
    }
    return result.access_token
  }

  async verifyInstallationConsent(installationId, code, options = {}) {
    const userToken = await this.exchangeOAuthCode(code, options)
    const writableRepositoryIds = new Set()
    for (let page = 1; page <= 20; page += 1) {
      let result
      try {
        result = await this.request(`${API_ORIGIN}/user/installations/${installationId}/repositories?per_page=100&page=${page}`, {
          token: userToken, deadlineMs: options.deadlineMs,
        })
      } catch (error) {
        if (error instanceof GitHubError && error.statusCode === 404) {
          throw new GitHubError('installation_consent_mismatch', 403)
        }
        throw error
      }
      if (!result || !Array.isArray(result.repositories)) throw new GitHubError('github_invalid_response')
      for (const item of result.repositories) {
        if (!Number.isSafeInteger(item?.id) || item.id < 1 || !item.permissions || typeof item.permissions !== 'object') {
          throw new GitHubError('github_invalid_response')
        }
        if (item.permissions.push === true || item.permissions.admin === true) writableRepositoryIds.add(String(item.id))
      }
      if (result.repositories.length < 100) break
      if (page === 20) throw new GitHubError('github_pagination_limit')
    }
    const grant = await this.getInstallationGrant(installationId, options)
    return { ...grant, repositories: grant.repositories.filter((item) => writableRepositoryIds.has(item.id)) }
  }

  appToken() {
    return appJwt(this.appId, this.privateKey, Math.floor(this.now() / 1000))
  }

  async installationToken(installationId, options = {}) {
    const result = await this.request(`${API_ORIGIN}/app/installations/${installationId}/access_tokens`, {
      method: 'POST', token: this.appToken(), body: {}, retry: false, deadlineMs: options.deadlineMs,
    })
    if (!result || typeof result.token !== 'string' || !result.permissions || typeof result.permissions !== 'object') {
      throw new GitHubError('github_invalid_response')
    }
    return { token: result.token, permissions: result.permissions }
  }

  async getInstallationGrant(installationId, options = {}) {
    const installation = await this.request(`${API_ORIGIN}/app/installations/${installationId}`, {
      token: this.appToken(), deadlineMs: options.deadlineMs,
    })
    if (!installation || String(installation.id) !== installationId ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(installation.account?.login || '')) {
      throw new GitHubError('github_invalid_response')
    }
    const credential = await this.installationToken(installationId, options)
    const repositories = []
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.request(`${API_ORIGIN}/installation/repositories?per_page=100&page=${page}`, {
        token: credential.token, deadlineMs: options.deadlineMs,
      })
      if (!result || !Array.isArray(result.repositories)) throw new GitHubError('github_invalid_response')
      repositories.push(...result.repositories.map(repository))
      if (result.repositories.length < 100) break
      if (page === 100) throw new GitHubError('github_pagination_limit')
    }
    return {
      installationId,
      accountLogin: installation.account.login,
      repositories,
      permissions: credential.permissions,
      token: credential.token,
    }
  }

  async listBranches(grant, githubRepositoryId, options = {}) {
    if (!grant.repositories.some((item) => item.id === githubRepositoryId)) throw new GitHubError('repository_not_granted', 404)
    const branches = []
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.request(`${API_ORIGIN}/repositories/${githubRepositoryId}/branches?per_page=100&page=${page}`, {
        token: grant.token, deadlineMs: options.deadlineMs,
      })
      if (!Array.isArray(result) || result.some((item) => typeof item?.name !== 'string' || item.name.length < 1 || item.name.length > 255 || /[\x00-\x1f\x7f]/.test(item.name))) {
        throw new GitHubError('github_invalid_response')
      }
      branches.push(...result.map((item) => item.name))
      if (result.length < 100) break
      if (page === 100) throw new GitHubError('github_pagination_limit')
    }
    return branches
  }

  hasPermissions(actual, required) {
    return Object.entries(required).every(([name, level]) =>
      (PERMISSION_LEVEL[actual[name]] ?? -1) >= PERMISSION_LEVEL[level])
  }

  async inspectRepository(grant, repositoryInfo, baseBranch, options = {}) {
    const [owner, name] = repositoryInfo.fullName.split('/')
    const encodedBranch = encodeURIComponent(baseBranch)
    const branch = await this.request(`${API_ORIGIN}/repos/${owner}/${name}/branches/${encodedBranch}`, {
      token: grant.token, deadlineMs: options.deadlineMs,
    })
    if (!branch || !/^[0-9a-f]{40}$/.test(branch.commit?.sha || '')) throw new GitHubError('github_invalid_response')
    return { branchSha: branch.commit.sha }
  }

  async exportSource(grant, repositoryInfo, baseBranch, options = {}) {
    const [owner, name] = repositoryInfo.fullName.split('/')
    const { branchSha } = await this.inspectRepository(grant, repositoryInfo, baseBranch, options)
    const commit = await this.request(`${API_ORIGIN}/repos/${owner}/${name}/git/commits/${branchSha}`, {
      token: grant.token, deadlineMs: options.deadlineMs,
    })
    if (!SHA_PATTERN.test(commit?.tree?.sha || '')) throw new GitHubError('github_invalid_response')
    const tree = await this.request(`${API_ORIGIN}/repos/${owner}/${name}/git/trees/${commit.tree.sha}?recursive=1`, {
      token: grant.token, deadlineMs: options.deadlineMs,
    })
    if (!tree || tree.truncated === true || !Array.isArray(tree.tree) || tree.tree.length > MAX_SOURCE_FILES) {
      throw new GitHubError('github_tree_unavailable')
    }
    const blobs = []
    for (const entry of tree.tree) {
      if (!safeTreePath(entry?.path) || !SHA_PATTERN.test(entry?.sha || '')) throw new GitHubError('github_unsafe_tree')
      if (entry.type === 'tree' && entry.mode === '040000') continue
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw new GitHubError('github_unsafe_tree')
      blobs.push(entry)
    }
    let totalBytes = 0
    const files = []
    for (const entry of blobs.sort((left, right) => left.path.localeCompare(right.path))) {
      const blob = await this.request(`${API_ORIGIN}/repos/${owner}/${name}/git/blobs/${entry.sha}`, {
        token: grant.token, deadlineMs: options.deadlineMs,
      })
      if (blob?.encoding !== 'base64' || typeof blob.content !== 'string' || !/^[A-Za-z0-9+/=\s]*$/.test(blob.content)) {
        throw new GitHubError('github_invalid_response')
      }
      const contentBase64 = blob.content.replace(/\s/g, '')
      if (contentBase64.length % 4 !== 0) throw new GitHubError('github_invalid_response')
      const bytes = Buffer.from(contentBase64, 'base64').length
      totalBytes += bytes
      if (bytes > MAX_SOURCE_BLOB_BYTES || totalBytes > MAX_SOURCE_BYTES) throw new GitHubError('github_tree_unavailable')
      files.push({ path: entry.path, mode: entry.mode, contentBase64 })
    }
    const result = { baseSha: branchSha, files }
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_SOURCE_RESPONSE_BYTES) throw new GitHubError('github_tree_unavailable')
    return result
  }

  async optionalRequest(url, options) {
    try {
      return await this.request(url, options)
    } catch (error) {
      if (error instanceof GitHubError && error.statusCode === 404) return null
      throw error
    }
  }

  async branchRefSha(grant, repositoryInfo, branch, options = {}) {
    const encodedBranch = encodeURIComponent(branch)
    const result = await this.optionalRequest(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/git/ref/heads/${encodedBranch}`, {
      token: grant.token, deadlineMs: options.deadlineMs,
    })
    if (result === null) return null
    if (!SHA_PATTERN.test(result?.object?.sha || '')) throw new GitHubError('github_invalid_response')
    return result.object.sha
  }

  async findPullRequest(grant, repositoryInfo, branch, baseBranch, options = {}) {
    const owner = repositoryInfo.fullName.split('/')[0]
    const query = new URLSearchParams({ state: 'all', head: `${owner}:${branch}`, base: baseBranch, per_page: '1' })
    const result = await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/pulls?${query}`, {
      token: grant.token, deadlineMs: options.deadlineMs,
    })
    if (!Array.isArray(result) || result.length > 1) throw new GitHubError('github_invalid_response')
    if (result.length === 0) return null
    const pullRequest = result[0]
    const expectedUrl = `https://github.com/${repositoryInfo.fullName}/pull/${pullRequest.number}`
    if (!Number.isSafeInteger(pullRequest?.number) || pullRequest.number < 1 || pullRequest.html_url !== expectedUrl ||
        !SHA_PATTERN.test(pullRequest.head?.sha || '') || pullRequest.base?.ref !== baseBranch) {
      throw new GitHubError('github_invalid_response')
    }
    return { number: pullRequest.number, url: pullRequest.html_url, headSha: pullRequest.head.sha, branch }
  }

  async createPullRequest(grant, repositoryInfo, input, headSha, options = {}) {
    try {
      const pullRequest = await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/pulls`, {
        method: 'POST', token: grant.token, retry: false, deadlineMs: options.deadlineMs,
        body: { title: input.title, body: input.body, head: input.branch, base: input.baseBranch },
      })
      const expectedUrl = `https://github.com/${repositoryInfo.fullName}/pull/${pullRequest?.number}`
      if (!Number.isSafeInteger(pullRequest?.number) || pullRequest.number < 1 || pullRequest.html_url !== expectedUrl ||
          pullRequest.head?.sha !== headSha) throw new GitHubError('github_invalid_response')
      return { number: pullRequest.number, url: pullRequest.html_url, headSha, branch: input.branch }
    } catch (error) {
      if (!(error instanceof GitHubError) || error.code !== 'github_conflict') throw error
      const existing = await this.findPullRequest(grant, repositoryInfo, input.branch, input.baseBranch, options)
      if (existing?.headSha !== headSha) throw new GitHubError('github_pull_request_conflict', 409)
      return existing
    }
  }

  async reconcilePullRequest(grant, repositoryInfo, input, headSha, options = {}) {
    const commit = await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/git/commits/${headSha}`, {
      token: grant.token, deadlineMs: options.deadlineMs,
    })
    const marker = `Open-Mercato-Operation: ${input.operationDigest}`
    if (typeof commit?.message !== 'string' || !commit.message.split('\n').includes(marker) ||
        commit.parents?.length !== 1 || commit.parents[0]?.sha !== input.baseSha) {
      throw new GitHubError('github_branch_conflict', 409)
    }
    const existing = await this.findPullRequest(grant, repositoryInfo, input.branch, input.baseBranch, options)
    return existing || this.createPullRequest(grant, repositoryInfo, input, headSha, options)
  }

  async openPullRequest(grant, repositoryInfo, input, options = {}) {
    const existingHead = await this.branchRefSha(grant, repositoryInfo, input.branch, options)
    if (existingHead) return this.reconcilePullRequest(grant, repositoryInfo, input, existingHead, options)

    const { branchSha } = await this.inspectRepository(grant, repositoryInfo, input.baseBranch, options)
    if (branchSha !== input.baseSha) throw new GitHubError('github_base_changed', 409)
    const baseCommit = await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/git/commits/${input.baseSha}`, {
      token: grant.token, deadlineMs: options.deadlineMs,
    })
    if (!SHA_PATTERN.test(baseCommit?.tree?.sha || '')) throw new GitHubError('github_invalid_response')
    const baseTree = await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/git/trees/${baseCommit.tree.sha}?recursive=1`, {
      token: grant.token, deadlineMs: options.deadlineMs,
    })
    if (baseTree?.truncated !== false || !Array.isArray(baseTree.tree)) throw new GitHubError('github_tree_unavailable')
    const baseEntries = new Map()
    for (const entry of baseTree.tree) {
      if (!safeTreePath(entry?.path) || !SHA_PATTERN.test(entry?.sha || '') || baseEntries.has(entry.path)) {
        throw new GitHubError('github_unsafe_tree')
      }
      baseEntries.set(entry.path, entry)
    }
    const treeEntries = []
    for (const file of input.files) {
      const existing = baseEntries.get(file.path)
      if (existing && (existing.type !== 'blob' || !['100644', '100755'].includes(existing.mode))) {
        throw new GitHubError('github_unsafe_tree')
      }
      const mode = existing?.mode || '100644'
      if (file.content === null) {
        treeEntries.push({ path: file.path, mode, type: 'blob', sha: null })
        continue
      }
      const blob = await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/git/blobs`, {
        method: 'POST', token: grant.token, retry: false, deadlineMs: options.deadlineMs,
        body: { content: Buffer.from(file.content, 'utf8').toString('base64'), encoding: 'base64' },
      })
      if (!SHA_PATTERN.test(blob?.sha || '')) throw new GitHubError('github_invalid_response')
      treeEntries.push({ path: file.path, mode, type: 'blob', sha: blob.sha })
    }
    const tree = await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/git/trees`, {
      method: 'POST', token: grant.token, retry: false, deadlineMs: options.deadlineMs,
      body: { base_tree: baseCommit.tree.sha, tree: treeEntries },
    })
    if (!SHA_PATTERN.test(tree?.sha || '')) throw new GitHubError('github_invalid_response')
    const marker = `Open-Mercato-Operation: ${input.operationDigest}`
    const commit = await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/git/commits`, {
      method: 'POST', token: grant.token, retry: false, deadlineMs: options.deadlineMs,
      body: { message: `${input.title}\n\n${marker}`, tree: tree.sha, parents: [input.baseSha] },
    })
    if (!SHA_PATTERN.test(commit?.sha || '')) throw new GitHubError('github_invalid_response')
    try {
      await this.request(`${API_ORIGIN}/repos/${repositoryInfo.fullName}/git/refs`, {
        method: 'POST', token: grant.token, retry: false, deadlineMs: options.deadlineMs,
        body: { ref: `refs/heads/${input.branch}`, sha: commit.sha },
      })
    } catch (error) {
      if (!(error instanceof GitHubError) || error.code !== 'github_conflict') throw error
      const racedHead = await this.branchRefSha(grant, repositoryInfo, input.branch, options)
      if (!racedHead) throw error
      return this.reconcilePullRequest(grant, repositoryInfo, input, racedHead, options)
    }
    return this.createPullRequest(grant, repositoryInfo, input, commit.sha, options)
  }
}
