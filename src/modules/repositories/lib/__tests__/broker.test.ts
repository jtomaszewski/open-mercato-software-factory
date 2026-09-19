import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { canonicalBrokerRequest, createRepositoryBroker, readBoundedBrokerRequestBody, signBrokerRequest, verifyBrokerCallbackSignature } from '../broker'

const originalEnv = { ...process.env }

afterEach(() => {
  jest.restoreAllMocks()
  process.env = { ...originalEnv }
})

describe('broker HMAC contract', () => {
  it('exports source and submits a PR through the signed execution routes with the frozen binding', async () => {
    process.env.REPOSITORIES_BROKER_URL = 'http://127.0.0.1:5010'
    process.env.REPOSITORIES_BROKER_KEY_ID = 'request-v1'
    process.env.REPOSITORIES_BROKER_REQUEST_SECRET = 'request-secret'
    process.env.REPOSITORIES_GITHUB_APP_SLUG = 'open-mercato-software-factory'
    const binding = { installationId: '123', authorizationId: '00000000-0000-4000-8000-000000000001', githubRepositoryId: '456',
      baseBranch: 'main', delegationId: '00000000-0000-4000-8000-000000000002', repositoryId: '00000000-0000-4000-8000-000000000003', epoch: 2, profileDigest: 'a'.repeat(64) }
    const source = { baseSha: 'b'.repeat(40), files: [{ path: 'index.ts', mode: '100644', contentBase64: 'eA==' }] }
    const pullRequest = { number: 1, url: 'https://github.com/owner/repository/pull/1', branch: `open-mercato/delegation-${binding.delegationId}`, headSha: 'c'.repeat(40) }
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(source)))
      .mockResolvedValueOnce(new Response(JSON.stringify(pullRequest)))
    const broker = createRepositoryBroker()
    await expect(broker.exportSource(binding)).resolves.toEqual(source)
    await expect(broker.openPullRequest({ ...binding, baseSha: source.baseSha, title: 'Change', body: 'Description', files: [{ path: 'index.ts', content: 'new' }] })).resolves.toEqual(pullRequest)
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/executions/source', '/executions/pull-requests'])
    for (const [, options] of fetchMock.mock.calls) {
      expect(JSON.parse(String(options?.body))).toMatchObject(binding)
      expect(new Headers(options?.headers).get('x-om-broker-signature')).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('canonicalizes method, path, sorted query and raw body without a trailing newline', () => {
    const canonical = canonicalBrokerRequest('get', new URL('https://broker.test/path?z=last&a=first'), '123', '00000000-0000-4000-8000-000000000000', '')
    expect(canonical).toBe([
      'GET', '/path', 'a=first&z=last', '123', '00000000-0000-4000-8000-000000000000',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n'))
    expect(canonical.endsWith('\n')).toBe(false)
    expect(canonicalBrokerRequest('GET', new URL('https://broker.test/path?a=lower&A=upper'), '123', '00000000-0000-4000-8000-000000000000', '').split('\n')[2]).toBe('A=upper&a=lower')
  })

  it('rejects duplicate query keys', () => {
    expect(() => canonicalBrokerRequest('GET', new URL('https://broker.test/path?a=1&a=2'), '123', '00000000-0000-4000-8000-000000000000', '')).toThrow()
  })

  it('cancels an unauthenticated callback body as soon as it exceeds one MiB', async () => {
    let chunk = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunk += 1
        controller.enqueue(new Uint8Array(600 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    const request = new Request('https://om.test/api/repositories/internal/qualification-results', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    await expect(readBoundedBrokerRequestBody(request)).resolves.toBeNull()
    expect(cancelled).toBe(true)
    expect(chunk).toBeLessThanOrEqual(3)
  })

  it('verifies the configured callback key, window and body binding', () => {
    process.env.REPOSITORIES_BROKER_KEY_ID = 'callback-v1'
    process.env.REPOSITORIES_BROKER_CALLBACK_SECRET = 'callback-secret'
    const now = 1_800_000_000
    const requestId = '00000000-0000-4000-8000-000000000001'
    const body = '{"ok":true}'
    const url = new URL('https://om.test/api/repositories/internal/qualification-results')
    const signature = signBrokerRequest('callback-secret', canonicalBrokerRequest('POST', url, String(now), requestId, body))
    const request = new Request(url, { method: 'POST', headers: {
      'x-om-broker-key-id': 'callback-v1', 'x-om-broker-timestamp': String(now), 'x-om-broker-request-id': requestId, 'x-om-broker-signature': signature,
    } })
    expect(verifyBrokerCallbackSignature({ request, rawBody: body, nowSeconds: now })).toEqual({ keyId: 'callback-v1', requestId })
    expect(verifyBrokerCallbackSignature({ request, rawBody: '{}', nowSeconds: now })).toBeNull()
    expect(verifyBrokerCallbackSignature({ request, rawBody: body, nowSeconds: now + 301 })).toBeNull()
  })

  it('builds the existing-installation OAuth URL from the public GitHub App client ID', () => {
    process.env.REPOSITORIES_BROKER_URL = 'http://127.0.0.1:5010'
    process.env.REPOSITORIES_BROKER_KEY_ID = 'request-v1'
    process.env.REPOSITORIES_BROKER_REQUEST_SECRET = 'request-secret'
    process.env.REPOSITORIES_GITHUB_APP_SLUG = 'open-mercato-software-factory'
    process.env.REPOSITORIES_GITHUB_APP_CLIENT_ID = 'Iv23AbCdEf1234567890'
    const url = new URL(createRepositoryBroker().buildAuthorizeUrl('state-value'))
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('Iv23AbCdEf1234567890')
    expect(url.searchParams.get('state')).toBe('state-value')
  })

  it('rejects a refresh response for another authorization binding', async () => {
    process.env.REPOSITORIES_BROKER_URL = 'http://127.0.0.1:5010'
    process.env.REPOSITORIES_BROKER_KEY_ID = 'request-v1'
    process.env.REPOSITORIES_BROKER_REQUEST_SECRET = 'request-secret'
    process.env.REPOSITORIES_GITHUB_APP_SLUG = 'open-mercato-software-factory'
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      installationId: '123',
      authorizationId: '00000000-0000-4000-8000-000000000099',
      accountLogin: 'acme',
      repositories: [],
    }), { status: 200 }))

    await expect(createRepositoryBroker().refreshInstallation({
      installationId: '123',
      authorizationId: '00000000-0000-4000-8000-000000000001',
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
