import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/

export class TransportError extends Error {
  constructor(statusCode, code) {
    super(code)
    this.name = 'TransportError'
    this.statusCode = statusCode
    this.code = code
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalQuery(searchParams) {
  const seen = new Set()
  const entries = []
  for (const [key, value] of searchParams) {
    if (seen.has(key)) throw new TransportError(400, 'duplicate query key')
    seen.add(key)
    entries.push([key, value])
  }
  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1
    return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1
  })
  return new URLSearchParams(entries).toString()
}

export function canonicalRequest({ method, url, timestamp, requestId, body }) {
  if (!(url instanceof URL) || !url.pathname.startsWith('/') || url.pathname.includes('\0')) {
    throw new TransportError(400, 'invalid request path')
  }
  try {
    decodeURIComponent(url.pathname)
  } catch {
    throw new TransportError(400, 'invalid request path encoding')
  }
  return [
    method.toUpperCase(),
    url.pathname,
    canonicalQuery(url.searchParams),
    timestamp,
    requestId,
    sha256(body),
  ].join('\n')
}

export function signRequest(canonical, secret) {
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

function oneHeader(headers, name) {
  const value = headers[name]
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new TransportError(401, 'invalid authentication headers')
    return value[0]
  }
  if (typeof value !== 'string' || value.length === 0 || value.includes(',')) {
    throw new TransportError(401, 'invalid authentication headers')
  }
  return value
}

export function verifySignedRequest({ method, url, headers, body, keys, nowSeconds, claimReplay }) {
  const keyId = oneHeader(headers, 'x-om-broker-key-id')
  const timestamp = oneHeader(headers, 'x-om-broker-timestamp')
  const requestId = oneHeader(headers, 'x-om-broker-request-id')
  const signature = oneHeader(headers, 'x-om-broker-signature')
  const secret = keys.get(keyId)
  if (!secret || !/^\d{10}$/.test(timestamp) || !UUID_PATTERN.test(requestId) || !SIGNATURE_PATTERN.test(signature)) {
    throw new TransportError(401, 'invalid authentication')
  }
  const requestTime = Number(timestamp)
  if (!Number.isSafeInteger(requestTime) || Math.abs(nowSeconds - requestTime) > 300) {
    throw new TransportError(401, 'expired authentication')
  }
  const canonical = canonicalRequest({ method, url, timestamp, requestId, body })
  const expected = signRequest(canonical, secret)
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new TransportError(401, 'invalid authentication')
  }
  if (!claimReplay(requestId, requestTime + 300)) throw new TransportError(409, 'request replayed')
  return { keyId, requestId }
}

export function signedHeaders({ method, url, body, keyId, secret, timestamp, requestId }) {
  const canonical = canonicalRequest({ method, url, timestamp, requestId, body })
  return {
    'content-type': 'application/json',
    'x-om-broker-key-id': keyId,
    'x-om-broker-timestamp': timestamp,
    'x-om-broker-request-id': requestId,
    'x-om-broker-signature': signRequest(canonical, secret),
  }
}
