import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { createGitHubApp, GitHubAppError, readGitHubAppConfigFromEnv } from '../github-app'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const config = { appId: '1', slug: 'om-factory', clientId: 'Iv1.client', clientSecret: 'secret', privateKey }
const repo = (id: number, fullName: string, permissions?: Record<string, boolean>) => ({ id, full_name: fullName, default_branch: 'main', ...(permissions ? { permissions } : {}) })

type Route = (url: string, init: RequestInit) => { status?: number; body: unknown } | undefined
let routes: Route[]
const requests: Array<{ url: string; init: RequestInit }> = []
const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  requests.push({ url, init: init ?? {} })
  for (const route of routes) {
    const hit = route(url, init ?? {})
    if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200 })
  }
  return new Response('{}', { status: 404 })
}) as unknown as typeof fetch

const app = createGitHubApp(() => config, fetchImpl)

beforeEach(() => {
  requests.length = 0
  routes = [
    (url) => url === 'https://api.github.com/app/installations/99' ? { body: { id: 99, account: { login: 'acme' } } } : undefined,
    (url, init) => url === 'https://api.github.com/app/installations/99/access_tokens'
      ? { body: { token: 'ghs_x', expires_at: '2026-09-19T20:00:00Z', repositories: JSON.parse(String(init.body)).repository_ids ? [repo(42, 'acme/site')] : undefined } }
      : undefined,
    (url) => url.startsWith('https://api.github.com/installation/repositories') ? { body: { repositories: [repo(42, 'acme/site'), repo(43, 'acme/other')] } } : undefined,
  ]
})

describe('GitHub App client', () => {
  it('issues an installation token restricted to one repository', async () => {
    await expect(app.repositoryToken('99', '42')).resolves.toEqual({ token: 'ghs_x', fullName: 'acme/site', expiresAt: '2026-09-19T20:00:00Z' })
    const tokenCall = requests.find((call) => call.url.endsWith('/access_tokens'))!
    expect(JSON.parse(String(tokenCall.init.body))).toEqual({ repository_ids: [42] })
    expect((tokenCall.init.headers as Record<string, string>).Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
  })

  it('keeps only repositories the consenting user can push to', async () => {
    routes.unshift(
      (url) => url === 'https://github.com/login/oauth/access_token' ? { body: { access_token: 'gho_user' } } : undefined,
      (url) => url.startsWith('https://api.github.com/user/installations/99/repositories')
        ? { body: { repositories: [repo(42, 'acme/site', { push: true }), repo(43, 'acme/other', { push: false, admin: false })] } }
        : undefined,
    )
    const grant = await app.verifyInstallationConsent('99', 'code')
    expect(grant.authorizedRepositoryIds).toEqual(['42'])
    expect(grant.repositories.map((item) => item.fullName)).toEqual(['acme/site'])
    expect(grant.accountLogin).toBe('acme')
  })

  it('sends the consent back to the origin that started it, and repeats it in the exchange', async () => {
    const redirect = 'http://localhost:55220/backend/repositories/connect'
    const authorize = new URL(app.buildAuthorizeUrl('state-1', redirect))
    expect(authorize.searchParams.get('redirect_uri')).toBe(redirect)
    expect(authorize.searchParams.get('state')).toBe('state-1')

    routes.unshift(
      (url) => url === 'https://github.com/login/oauth/access_token' ? { body: { access_token: 'gho_user' } } : undefined,
      (url) => url.startsWith('https://api.github.com/user/installations/99/repositories')
        ? { body: { repositories: [repo(42, 'acme/site', { push: true })] } }
        : undefined,
    )
    await app.verifyInstallationConsent('99', 'code', redirect)
    const exchange = requests.find((call) => call.url === 'https://github.com/login/oauth/access_token')!
    // GitHub answers `redirect_uri_mismatch` when the exchange omits a redirect_uri the
    // authorize step sent, and the consent click is then wasted.
    expect(JSON.parse(String(exchange.init.body)).redirect_uri).toBe(redirect)
  })

  it('omits redirect_uri entirely when no origin is known, rather than sending an empty one', async () => {
    expect(new URL(app.buildAuthorizeUrl('state-1')).searchParams.has('redirect_uri')).toBe(false)
    expect(new URL(app.buildAuthorizeUrl('state-1', null)).searchParams.has('redirect_uri')).toBe(false)

    routes.unshift(
      (url) => url === 'https://github.com/login/oauth/access_token' ? { body: { access_token: 'gho_user' } } : undefined,
      (url) => url.startsWith('https://api.github.com/user/installations/99/repositories')
        ? { body: { repositories: [repo(42, 'acme/site', { push: true })] } }
        : undefined,
    )
    await app.verifyInstallationConsent('99', 'code')
    const exchange = requests.find((call) => call.url === 'https://github.com/login/oauth/access_token')!
    expect(JSON.parse(String(exchange.init.body))).not.toHaveProperty('redirect_uri')
  })

  it('refuses consent for an installation the user cannot see', async () => {
    routes.unshift((url) => url === 'https://github.com/login/oauth/access_token' ? { body: { access_token: 'gho_user' } } : undefined)
    await expect(app.verifyInstallationConsent('99', 'code')).rejects.toEqual(new GitHubAppError('consent_refused'))
  })

  it('narrows a refreshed grant to the consented repositories', async () => {
    const grant = await app.getInstallationGrant('99', ['43'])
    expect(grant.repositories.map((item) => item.id)).toEqual(['43'])
  })
})

describe('GitHub App configuration', () => {
  it('is not configured without every value, and reads an escaped inline key', () => {
    expect(() => readGitHubAppConfigFromEnv({})).toThrow(new GitHubAppError('not_configured'))
    const env = {
      REPOSITORIES_GITHUB_APP_ID: '1', REPOSITORIES_GITHUB_APP_SLUG: 'om-factory', REPOSITORIES_GITHUB_APP_CLIENT_ID: 'c',
      REPOSITORIES_GITHUB_APP_CLIENT_SECRET: 's', REPOSITORIES_GITHUB_APP_PRIVATE_KEY: '-----BEGIN KEY-----\\nabc\\n-----END KEY-----',
    }
    expect(readGitHubAppConfigFromEnv(env).privateKey).toBe('-----BEGIN KEY-----\nabc\n-----END KEY-----')
  })
})
