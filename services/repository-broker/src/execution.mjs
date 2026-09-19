import { randomUUID } from 'node:crypto'

import { sha256, signedHeaders } from './transport.mjs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA_PATTERN = /^[0-9a-f]{40}$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const MAX_USABILITY_RESPONSE_BYTES = 16 * 1024
const MAX_PULL_REQUEST_FILES = 100
const MAX_FILE_BYTES = 768 * 1024
const MAX_TOTAL_FILE_BYTES = 896 * 1024
const USABILITY_REASONS = new Set([
  'binding_unavailable',
  'repository_unlinked',
  'repository_unavailable',
  'repository_changed',
])

export class ExecutionError extends Error {
  constructor(code, statusCode = 400) {
    super(code)
    this.name = 'ExecutionError'
    this.code = code
    this.statusCode = statusCode
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function exactKeys(value, required) {
  if (!plainObject(value)) return false
  const keys = Object.keys(value)
  return keys.length === required.length && required.every((key) => keys.includes(key))
}

function boundedString(value, maximum, { blank = false } = {}) {
  return typeof value === 'string' && value.length <= maximum && !value.includes('\0') && (blank || value.trim().length > 0)
}

function validBaseBranch(value) {
  return boundedString(value, 255) && !/[\x00-\x20~^:?*[\\]/.test(value) && !value.includes('..') &&
    !value.startsWith('-') && !value.endsWith('/') && !value.endsWith('.lock')
}

function safePath(value) {
  if (!boundedString(value, 500) || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && segment.toLowerCase() !== '.git')
}

function bindingValid(value) {
  return /^\d{1,32}$/.test(value.installationId) && UUID_PATTERN.test(value.authorizationId) &&
    /^\d{1,32}$/.test(value.githubRepositoryId) && validBaseBranch(value.baseBranch) &&
    UUID_PATTERN.test(value.delegationId) && UUID_PATTERN.test(value.repositoryId) &&
    Number.isSafeInteger(value.epoch) && value.epoch > 0 && DIGEST_PATTERN.test(value.profileDigest)
}

const BINDING_KEYS = [
  'installationId', 'authorizationId', 'githubRepositoryId', 'baseBranch',
  'delegationId', 'repositoryId', 'epoch', 'profileDigest',
]

export function validateSourceRequest(value) {
  if (!exactKeys(value, BINDING_KEYS) || !bindingValid(value)) throw new ExecutionError('invalid_execution_request')
  return value
}

export function validatePullRequestRequest(value) {
  const keys = [...BINDING_KEYS, 'baseSha', 'title', 'body', 'files']
  if (!exactKeys(value, keys) || !bindingValid(value) || !SHA_PATTERN.test(value.baseSha) ||
      !boundedString(value.title, 120) || !boundedString(value.body, 64 * 1024, { blank: true }) ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAX_PULL_REQUEST_FILES) {
    throw new ExecutionError('invalid_execution_request')
  }
  const seen = new Set()
  let totalBytes = 0
  for (const file of value.files) {
    if (!exactKeys(file, ['path', 'content']) || !safePath(file.path) || seen.has(file.path) ||
        (file.content !== null && typeof file.content !== 'string')) {
      throw new ExecutionError('invalid_execution_request')
    }
    seen.add(file.path)
    if (file.content !== null) {
      const bytes = Buffer.byteLength(file.content)
      if (bytes > MAX_FILE_BYTES) throw new ExecutionError('invalid_execution_request')
      totalBytes += bytes
      if (totalBytes > MAX_TOTAL_FILE_BYTES) throw new ExecutionError('invalid_execution_request')
    }
  }
  return value
}

function protectedPath(path) {
  return path.startsWith('.github/') || path.startsWith('.git/') || path === '.gitmodules' ||
    path === 'vercel.json' || path.startsWith('.vercel/') || path.startsWith('.env')
}

async function readBoundedJson(response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_USABILITY_RESPONSE_BYTES) throw new ExecutionError('usability_invalid_response', 503)
  const chunks = []
  let total = 0
  for await (const chunk of response.body || []) {
    total += chunk.length
    if (total > MAX_USABILITY_RESPONSE_BYTES) throw new ExecutionError('usability_invalid_response', 503)
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ExecutionError('usability_invalid_response', 503)
  }
}

export class OmUsabilityClient {
  constructor({ omBaseUrl, keyId, secret, fetchImpl = globalThis.fetch, now = () => Date.now(), requestId = randomUUID }) {
    this.omBaseUrl = omBaseUrl
    this.keyId = keyId
    this.secret = secret
    this.fetchImpl = fetchImpl
    this.now = now
    this.requestId = requestId
  }

  async assertUsable(binding) {
    const url = new URL('/api/repositories/internal/usability', this.omBaseUrl)
    url.searchParams.set('delegationId', binding.delegationId)
    url.searchParams.set('repositoryId', binding.repositoryId)
    url.searchParams.set('epoch', String(binding.epoch))
    url.searchParams.set('profileDigest', binding.profileDigest)
    url.searchParams.set('installationId', binding.installationId)
    url.searchParams.set('authorizationId', binding.authorizationId)
    url.searchParams.set('githubRepositoryId', binding.githubRepositoryId)
    url.searchParams.set('baseBranch', binding.baseBranch)
    const body = Buffer.alloc(0)
    const headers = signedHeaders({
      method: 'GET', url, body, keyId: this.keyId, secret: this.secret,
      timestamp: String(Math.floor(this.now() / 1000)), requestId: this.requestId(),
    })
    let response
    try {
      response = await this.fetchImpl(url, {
        method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new ExecutionError('usability_unavailable', 503)
    }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {})
      throw new ExecutionError('usability_unavailable', 503)
    }
    const result = await readBoundedJson(response)
    if (exactKeys(result, ['usable']) && result.usable === true) return
    if (exactKeys(result, ['usable', 'reason']) && result.usable === false && USABILITY_REASONS.has(result.reason)) {
      throw new ExecutionError(result.reason, 409)
    }
    throw new ExecutionError('usability_invalid_response', 503)
  }
}

export class RepositoryExecutionService {
  constructor({ github, usability }) {
    this.github = github
    this.usability = usability
  }

  async target(input, permissions) {
    await this.usability.assertUsable(input)
    const grant = await this.github.getInstallationGrant(input.installationId, input.authorizationId)
    const repository = grant.repositories.find((item) => item.id === input.githubRepositoryId)
    if (!repository) throw new ExecutionError('repository_not_authorized', 404)
    if (!this.github.hasPermissions(grant.permissions, permissions)) {
      throw new ExecutionError('repository_permissions_missing', 403)
    }
    return { grant, repository }
  }

  async exportSource(input) {
    const { grant, repository } = await this.target(input, { metadata: 'read', contents: 'read' })
    return this.github.exportSource(grant, repository, input.baseBranch)
  }

  async openPullRequest(input) {
    if (input.files.some((file) => protectedPath(file.path))) throw new ExecutionError('protected_path', 409)
    const { grant, repository } = await this.target(input, {
      metadata: 'read', contents: 'write', pull_requests: 'write',
    })
    const files = [...input.files].sort((left, right) => left.path.localeCompare(right.path))
    const operationDigest = sha256(JSON.stringify({
      delegationId: input.delegationId,
      repositoryId: input.repositoryId,
      githubRepositoryId: input.githubRepositoryId,
      baseBranch: input.baseBranch,
      baseSha: input.baseSha,
      title: input.title,
      body: input.body,
      files,
    }))
    const branch = `open-mercato/delegation-${input.delegationId}`
    return this.github.openPullRequest(grant, repository, { ...input, files, operationDigest, branch })
  }
}
