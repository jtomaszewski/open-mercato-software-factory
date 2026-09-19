import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalBrokerRequest,
  signBrokerRequest,
  verifyBrokerCallbackSignature,
} from '../../src/modules/repositories/lib/broker.ts'
import {
  canonicalRequest,
  signedHeaders,
  verifySignedRequest,
} from '../../services/repository-broker/src/transport.mjs'

const timestamp = '1790000000'
const requestId = '11111111-1111-4111-8111-111111111111'
const requestSecret = 'request-secret-for-contract-tests-only'
const callbackSecret = 'callback-secret-for-contract-tests-only'

test('OM and standalone broker share canonical bytes across query encodings', () => {
  for (const path of [
    '/qualifications',
    '/repositories/12/branches?installationId=34&authorizationId=example',
    '/callback?z=last&A=upper&a=lower&b=space+and%2Bplus&unicode=%C5%82',
  ]) {
    const url = new URL(path, 'https://broker.example')
    const body = JSON.stringify({ text: 'Zażółć gęślą', count: 3 })
    assert.equal(
      canonicalBrokerRequest('post', url, timestamp, requestId, body),
      canonicalRequest({ method: 'post', url, timestamp, requestId, body }),
    )
  }
})

test('broker verifies OM signatures and rejects tampering and replay', () => {
  const url = new URL('https://broker.example/qualifications')
  const body = '{"attemptId":"11111111-1111-4111-8111-111111111111"}'
  const headers = {
    'x-om-broker-key-id': 'test',
    'x-om-broker-timestamp': timestamp,
    'x-om-broker-request-id': requestId,
    'x-om-broker-signature': signBrokerRequest(requestSecret, canonicalBrokerRequest('POST', url, timestamp, requestId, body)),
  }
  const claimed = new Set()
  const options = {
    method: 'POST', url, headers, body, nowSeconds: Number(timestamp),
    keys: new Map([['test', requestSecret]]),
    claimReplay(id) {
      if (claimed.has(id)) return false
      claimed.add(id)
      return true
    },
  }
  assert.throws(() => verifySignedRequest({ ...options, body: '{}' }), /invalid authentication/)
  assert.deepEqual(verifySignedRequest(options), { keyId: 'test', requestId })
  assert.throws(() => verifySignedRequest(options), /request replayed/)
})

test('OM verifies standalone broker callback signatures with separate directional keys', () => {
  const names = ['REPOSITORIES_BROKER_KEY_ID', 'REPOSITORIES_BROKER_CALLBACK_SECRET']
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  process.env.REPOSITORIES_BROKER_KEY_ID = 'test'
  process.env.REPOSITORIES_BROKER_CALLBACK_SECRET = callbackSecret
  try {
    const url = new URL('https://om.example/api/repositories/internal/qualification-results')
    const body = '{"status":"failed"}'
    const makeRequest = (secret) => new Request(url, {
      method: 'POST', body,
      headers: signedHeaders({ method: 'POST', url, body, keyId: 'test', secret, timestamp, requestId }),
    })
    assert.deepEqual(verifyBrokerCallbackSignature({ request: makeRequest(callbackSecret), rawBody: body, nowSeconds: Number(timestamp) }), { keyId: 'test', requestId })
    assert.equal(verifyBrokerCallbackSignature({ request: makeRequest(requestSecret), rawBody: body, nowSeconds: Number(timestamp) }), null)
    assert.equal(verifyBrokerCallbackSignature({ request: makeRequest(callbackSecret), rawBody: '{}', nowSeconds: Number(timestamp) }), null)
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
})
