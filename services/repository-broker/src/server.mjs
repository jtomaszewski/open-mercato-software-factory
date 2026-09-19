import { createServer } from 'node:http'

import { ExecutionError, validatePullRequestRequest, validateSourceRequest } from './execution.mjs'
import { GitHubError } from './github.mjs'
import { sha256, TransportError, verifySignedRequest } from './transport.mjs'
import { ValidationError, validateQualificationRequest } from './qualification.mjs'

const MAX_BODY_BYTES = 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function canonicalPayload(value) {
  if (Array.isArray(value)) return value.map(canonicalPayload)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalPayload(value[key])]))
  }
  return value
}

function responseJson(response, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

async function readBody(request) {
  const declaredLength = Number(request.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new TransportError(413, 'request_too_large')
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new TransportError(413, 'request_too_large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function parseObject(body) {
  try {
    const parsed = JSON.parse(body.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not_object')
    return parsed
  } catch {
    throw new ValidationError('invalid_json')
  }
}

function installationInput(value) {
  if (Object.keys(value).length !== 2 || !/^\d{1,32}$/.test(value.installationId) ||
      typeof value.code !== 'string' || value.code.length < 1 || value.code.length > 1024) {
    throw new ValidationError('invalid_installation_verification')
  }
  return value
}

function publicGrant(grant) {
  return {
    installationId: grant.installationId,
    authorizationId: grant.authorizationId,
    accountLogin: grant.accountLogin,
    repositories: grant.repositories.map(({ id, fullName, defaultBranch }) => ({ id, fullName, defaultBranch })),
  }
}

export function createBrokerServer({ requestKeys, store, github, worker, execution, now = () => Date.now() }) {
  return createServer(async (request, response) => {
    try {
      const body = await readBody(request)
      let url
      try {
        decodeURIComponent(request.url.replaceAll('+', '%20'))
        const rawPath = request.url.split('?')[0]
        const decodedPath = decodeURIComponent(rawPath)
        if (!rawPath.startsWith('/') || rawPath.includes('\\') || /%2f|%5c/i.test(rawPath) ||
            /[\x00-\x1f\x7f\\]/.test(decodedPath) ||
            decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
          throw new Error('invalid_path')
        }
        url = new URL(request.url, 'http://broker.invalid')
        if (url.pathname !== rawPath) throw new Error('normalized_path')
      } catch {
        throw new TransportError(400, 'invalid_request_target')
      }
      verifySignedRequest({
        method: request.method || '', url, headers: request.headers, body, keys: requestKeys,
        nowSeconds: Math.floor(now() / 1000),
        claimReplay: (requestId, expiresAt) => store.claimReplay(requestId, expiresAt, Math.floor(now() / 1000)),
      })

      if (request.method === 'POST' && url.pathname === '/installations/verify' && url.search === '') {
        const input = installationInput(parseObject(body))
        const grant = await github.verifyInstallationConsent(input.installationId, input.code)
        responseJson(response, 200, publicGrant(grant))
        return
      }

      const installationMatch = request.method === 'GET' && url.pathname.match(/^\/installations\/(\d{1,32})$/)
      if (installationMatch && [...url.searchParams.keys()].length === 1 && UUID_PATTERN.test(url.searchParams.get('authorizationId') || '')) {
        const authorizationId = url.searchParams.get('authorizationId')
        const grant = await github.getInstallationGrant(installationMatch[1], authorizationId)
        grant.authorizationId = authorizationId
        responseJson(response, 200, publicGrant(grant))
        return
      }

      const branchesMatch = request.method === 'GET' && url.pathname.match(/^\/repositories\/(\d{1,32})\/branches$/)
      if (branchesMatch && [...url.searchParams.keys()].length === 2 && /^\d{1,32}$/.test(url.searchParams.get('installationId') || '') &&
          UUID_PATTERN.test(url.searchParams.get('authorizationId') || '')) {
        const branches = await github.listBranches(
          url.searchParams.get('installationId'), url.searchParams.get('authorizationId'), branchesMatch[1],
        )
        responseJson(response, 200, { branches })
        return
      }

      if (request.method === 'POST' && url.pathname === '/qualifications' && url.search === '') {
        const input = validateQualificationRequest(parseObject(body))
        const payloadJson = JSON.stringify(canonicalPayload(input))
        const claim = store.claimAttempt(input.attemptId, sha256(payloadJson), payloadJson, Math.floor(now() / 1000))
        if (claim === 'conflict') throw new TransportError(409, 'attempt_payload_conflict')
        if (claim === 'created') worker.wake()
        responseJson(response, 202, { accepted: true, attemptId: input.attemptId })
        return
      }

      if (request.method === 'POST' && url.pathname === '/executions/source' && url.search === '') {
        const input = validateSourceRequest(parseObject(body))
        responseJson(response, 200, await execution.exportSource(input))
        return
      }

      if (request.method === 'POST' && url.pathname === '/executions/pull-requests' && url.search === '') {
        const input = validatePullRequestRequest(parseObject(body))
        responseJson(response, 200, await execution.openPullRequest(input))
        return
      }

      throw new TransportError(404, 'route_not_found')
    } catch (error) {
      if (response.headersSent) {
        response.destroy()
        return
      }
      if (error instanceof TransportError) responseJson(response, error.statusCode, { error: error.code.replaceAll(' ', '_') })
      else if (error instanceof ValidationError) responseJson(response, 400, { error: error.code })
      else if (error instanceof ExecutionError) responseJson(response, error.statusCode, { error: error.code })
      else if (error instanceof GitHubError) responseJson(response, error.statusCode, { error: error.code })
      else responseJson(response, 500, { error: 'internal_error' })
    }
  })
}
