import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { brokerInstallationGrantSchema, grantedRepositorySchema } from '../data/validators'

const branchResponseSchema = z.object({ branches: z.array(z.string().min(1).max(255)).max(10000) }).strict()
const qualificationAcceptedSchema = z.object({ accepted: z.literal(true), attemptId: z.string().uuid() }).strict()
const executionSourceSchema = z.object({
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  files: z.array(z.object({ path: z.string().min(1), mode: z.enum(['100644', '100755']), contentBase64: z.string() }).strict()).max(10000),
}).strict()
const executionPullRequestSchema = z.object({ number: z.number().int().positive(), url: z.string().url(), headSha: z.string().regex(/^[a-f0-9]{40}$/), branch: z.string().min(1) }).strict()
const MAX_BODY_BYTES = 1024 * 1024
const SIGNATURE_WINDOW_SECONDS = 300

export type RepositoryBrokerQualification = {
  installationId: string
  authorizationId: string
  repositoryId: string
  githubRepositoryId: string
  baseBranch: string
  epoch: number
  attemptId: string
  kind: 'pr_only' | 'static_site'
  profile: Record<string, unknown>
}

export type RepositoryBroker = {
  isConfigured(): boolean
  buildInstallUrl(state: string): string
  buildAuthorizeUrl(state: string): string
  verifyInstallation(input: { installationId: string; code: string }): Promise<z.infer<typeof brokerInstallationGrantSchema>>
  refreshInstallation(input: { installationId: string; authorizationId: string }): Promise<z.infer<typeof brokerInstallationGrantSchema>>
  listBranches(input: { installationId: string; authorizationId: string; githubRepositoryId: string }): Promise<string[]>
  qualify(input: RepositoryBrokerQualification): Promise<void>
  exportSource(input: RepositoryExecutionBinding): Promise<z.infer<typeof executionSourceSchema>>
  openPullRequest(input: RepositoryExecutionBinding & { baseSha: string; title: string; body: string; files: Array<{ path: string; content: string | null }> }): Promise<z.infer<typeof executionPullRequestSchema>>
}

export type RepositoryExecutionBinding = {
  installationId: string
  authorizationId: string
  githubRepositoryId: string
  baseBranch: string
  delegationId: string
  repositoryId: string
  epoch: number
  profileDigest: string
}

export class RepositoryBrokerError extends Error {
  constructor(readonly code: 'not_configured' | 'invalid_configuration' | 'unavailable' | 'invalid_response') {
    super(`Repository broker error: ${code}`)
    this.name = 'RepositoryBrokerError'
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalBrokerRequest(method: string, url: URL, timestamp: string, requestId: string, rawBody: string): string {
  const seen = new Set<string>()
  const entries: Array<[string, string]> = []
  for (const [key, value] of url.searchParams.entries()) {
    if (seen.has(key)) throw new RepositoryBrokerError('invalid_configuration')
    seen.add(key)
    entries.push([key, value])
  }
  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1
    if (leftValue === rightValue) return 0
    return leftValue < rightValue ? -1 : 1
  })
  const query = new URLSearchParams(entries).toString()
  return [method.toUpperCase(), url.pathname, query, timestamp, requestId, sha256Hex(rawBody)].join('\n')
}

export function signBrokerRequest(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

export async function readBoundedBrokerRequestBody(request: Request): Promise<string | null> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
    await request.body?.cancel()
    return null
  }
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return null
  }
}

function validateBrokerBaseUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new RepositoryBrokerError('invalid_configuration')
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new RepositoryBrokerError('invalid_configuration')
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new RepositoryBrokerError('invalid_configuration')
  }
  return url
}

function validateGithubAppSlug(raw: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(raw)) throw new RepositoryBrokerError('invalid_configuration')
  return raw
}

function validateGithubAppClientId(raw: string): string {
  if (!/^[A-Za-z0-9]{1,200}$/.test(raw)) throw new RepositoryBrokerError('invalid_configuration')
  return raw
}

function configuredValue(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

export function createRepositoryBroker(): RepositoryBroker {
  const readConfiguration = () => {
    const rawUrl = configuredValue('REPOSITORIES_BROKER_URL')
    const keyId = configuredValue('REPOSITORIES_BROKER_KEY_ID')
    const secret = configuredValue('REPOSITORIES_BROKER_REQUEST_SECRET')
    const appSlug = configuredValue('REPOSITORIES_GITHUB_APP_SLUG')
    if (!rawUrl || !keyId || !secret || !appSlug) throw new RepositoryBrokerError('not_configured')
    return { baseUrl: validateBrokerBaseUrl(rawUrl), keyId, secret, appSlug: validateGithubAppSlug(appSlug) }
  }

  const request = async <T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, body?: unknown, query?: Record<string, string>, maxResponseBytes = MAX_BODY_BYTES): Promise<T> => {
    const config = readConfiguration()
    const url = new URL(path, config.baseUrl)
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const rawBody = body === undefined ? '' : JSON.stringify(body)
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) throw new RepositoryBrokerError('invalid_configuration')
    const timestamp = String(Math.floor(Date.now() / 1000))
    const requestId = randomUUID()
    const signature = signBrokerRequest(config.secret, canonicalBrokerRequest(method, url, timestamp, requestId, rawBody))
    let response: Response
    try {
      response = await fetch(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(path.startsWith('/executions/') ? 120_000 : 15_000),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-om-broker-key-id': config.keyId,
          'x-om-broker-timestamp': timestamp,
          'x-om-broker-request-id': requestId,
          'x-om-broker-signature': signature,
        },
        ...(body === undefined ? {} : { body: rawBody }),
      })
    } catch {
      throw new RepositoryBrokerError('unavailable')
    }
    if (!response.ok) throw new RepositoryBrokerError('unavailable')
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw new RepositoryBrokerError('invalid_response')
    let decoded: unknown
    try {
      decoded = JSON.parse(text)
    } catch {
      throw new RepositoryBrokerError('invalid_response')
    }
    const parsed = schema.safeParse(decoded)
    if (!parsed.success) throw new RepositoryBrokerError('invalid_response')
    return parsed.data
  }

  return {
    isConfigured() {
      try {
        readConfiguration()
        return true
      } catch {
        return false
      }
    },
    buildInstallUrl(state) {
      const { appSlug } = readConfiguration()
      const url = new URL(`https://github.com/apps/${appSlug}/installations/new`)
      url.searchParams.set('state', state)
      return url.toString()
    },
    buildAuthorizeUrl(state) {
      const clientId = configuredValue('REPOSITORIES_GITHUB_APP_CLIENT_ID')
      if (!clientId) throw new RepositoryBrokerError('not_configured')
      const url = new URL('https://github.com/login/oauth/authorize')
      url.searchParams.set('client_id', validateGithubAppClientId(clientId))
      url.searchParams.set('state', state)
      return url.toString()
    },
    verifyInstallation(input) {
      return request('POST', '/installations/verify', brokerInstallationGrantSchema, input)
    },
    async refreshInstallation(input) {
      const grant = await request('GET', `/installations/${encodeURIComponent(input.installationId)}`, brokerInstallationGrantSchema, undefined, { authorizationId: input.authorizationId })
      if (grant.installationId !== input.installationId || grant.authorizationId !== input.authorizationId) {
        throw new RepositoryBrokerError('invalid_response')
      }
      return grant
    },
    async listBranches(input) {
      const result = await request('GET', `/repositories/${encodeURIComponent(input.githubRepositoryId)}/branches`, branchResponseSchema, undefined, { installationId: input.installationId, authorizationId: input.authorizationId })
      return result.branches
    },
    async qualify(input) {
      const accepted = await request('POST', '/qualifications', qualificationAcceptedSchema, input)
      if (accepted.attemptId !== input.attemptId) throw new RepositoryBrokerError('invalid_response')
    },
    exportSource(input) {
      return request('POST', '/executions/source', executionSourceSchema, input, undefined, 48 * 1024 * 1024)
    },
    openPullRequest(input) {
      return request('POST', '/executions/pull-requests', executionPullRequestSchema, input)
    },
  }
}

export type CallbackSignatureInput = {
  request: Request
  rawBody: string
  nowSeconds?: number
}

export function verifyBrokerCallbackSignature(input: CallbackSignatureInput): { keyId: string; requestId: string } | null {
  const keyId = input.request.headers.get('x-om-broker-key-id')?.trim() ?? ''
  const timestamp = input.request.headers.get('x-om-broker-timestamp')?.trim() ?? ''
  const requestId = input.request.headers.get('x-om-broker-request-id')?.trim() ?? ''
  const signature = input.request.headers.get('x-om-broker-signature')?.trim() ?? ''
  const configuredKeyId = configuredValue('REPOSITORIES_BROKER_KEY_ID')
  const secret = configuredValue('REPOSITORIES_BROKER_CALLBACK_SECRET')
  if (!configuredKeyId || !secret || keyId !== configuredKeyId || !/^\d+$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature) || !z.string().uuid().safeParse(requestId).success) return null
  const seconds = Number(timestamp)
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(seconds) || Math.abs(now - seconds) > SIGNATURE_WINDOW_SECONDS) return null
  if (Buffer.byteLength(input.rawBody, 'utf8') > MAX_BODY_BYTES) return null
  let url: URL
  try {
    url = new URL(input.request.url)
    decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  let canonical: string
  try {
    canonical = canonicalBrokerRequest(input.request.method, url, timestamp, requestId, input.rawBody)
  } catch {
    return null
  }
  const expected = signBrokerRequest(secret, canonical)
  const actualBuffer = Buffer.from(signature, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null
  return { keyId, requestId }
}

export const brokerGrantedRepositorySchema = grantedRepositorySchema
