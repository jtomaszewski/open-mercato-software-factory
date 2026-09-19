import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'

import { canonicalRequest, signRequest } from '../src/transport.mjs'

test('canonicalRequest implements the broker wire contract exactly', () => {
  const body = Buffer.from('{"installationId":"42"}')
  const canonical = canonicalRequest({
    method: 'post',
    url: new URL('http://127.0.0.1/installations/verify?z=last&a=hello%20world'),
    timestamp: '1789770000',
    requestId: '6dcfe0bd-9f35-4ec4-8abc-94746b0bbccc',
    body,
  })

  assert.equal(canonical, [
    'POST',
    '/installations/verify',
    'a=hello+world&z=last',
    '1789770000',
    '6dcfe0bd-9f35-4ec4-8abc-94746b0bbccc',
    '035a9ddc3bff7607dcaa5f0dec29614316670523a01c54e132dbdf3ba0246eab',
  ].join('\n'))

  assert.equal(
    signRequest(canonical, 'request-secret'),
    createHmac('sha256', 'request-secret').update(canonical).digest('hex'),
  )
})

test('canonicalRequest rejects duplicate query keys', () => {
  assert.throws(() => canonicalRequest({
    method: 'GET',
    url: new URL('http://127.0.0.1/repositories/1/branches?installationId=1&installationId=2'),
    timestamp: '1789770000',
    requestId: '6dcfe0bd-9f35-4ec4-8abc-94746b0bbccc',
    body: Buffer.alloc(0),
  }), /duplicate query key/)
})
