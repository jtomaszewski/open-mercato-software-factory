import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { GrantedRepository, InstallationGrant } from '../data/validators'

/**
 * The GitHub App calls the registry needs, made from the app process: consent verification when
 * an installation is connected, the installation's repositories and branches, and a short-lived
 * installation token limited to one repository for a delegated code change. The App's private key and client
 * secret come from the environment; tokens are never persisted.
 */

export const REPOSITORY_GITHUB_APP = 'repositoryGitHubApp'

const API_ORIGIN = 'https://api.github.com'
const WEB_ORIGIN = 'https://github.com'
const PAGE_LIMIT = 50

export type GitHubAppConfig = {
  appId: string
  slug: string
  clientId: string
  clientSecret: string
  privateKey: string
}

export type RepositoryToken = { token: string; fullName: string; expiresAt: string }

/** The head commit of a repository's base branch — what "the version this repo is on" means here. */
export type RepositoryHeadCommit = {
  sha: string
  /** First line of the commit message: what changed, in the words of whoever changed it. */
  subject: string
  authorName: string | null
  committedAt: string | null
  htmlUrl: string | null
}

export class GitHubAppError extends Error {
  constructor(readonly code: 'not_configured' | 'unavailable' | 'consent_refused' | 'not_granted' | 'invalid_response') {
    super(`GitHub App error: ${code}`)
    this.name = 'GitHubAppError'
  }
}

export type GitHubApp = {
  isConfigured(): boolean
  buildInstallUrl(state: string): string
  buildAuthorizeUrl(state: string): string
  /** Exchanges the OAuth code and keeps only repositories the consenting user can push to. */
  verifyInstallationConsent(installationId: string, code: string): Promise<InstallationGrant & { authorizedRepositoryIds: string[] }>
  /** The installation's current repositories, narrowed to the ones consented at connect time. */
  getInstallationGrant(installationId: string, authorizedRepositoryIds: readonly string[]): Promise<InstallationGrant>
  listBranches(installationId: string, githubRepositoryId: string): Promise<string[]>
  /** An installation token that can reach only this repository (valid ~1 h). */
  repositoryToken(installationId: string, githubRepositoryId: string): Promise<RepositoryToken>
  /** The newest commit on `branch`, or null when the branch has none we can read. */
  headCommit(installationId: string, githubRepositoryId: string, branch: string): Promise<RepositoryHeadCommit | null>
}

function envValue(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name]?.trim()
  return value ? value : null
}

export function readGitHubAppConfigFromEnv(env: Record<string, string | undefined> = process.env): GitHubAppConfig {
  const appId = envValue(env, 'REPOSITORIES_GITHUB_APP_ID')
  const slug = envValue(env, 'REPOSITORIES_GITHUB_APP_SLUG')
  const clientId = envValue(env, 'REPOSITORIES_GITHUB_APP_CLIENT_ID')
  const clientSecret = envValue(env, 'REPOSITORIES_GITHUB_APP_CLIENT_SECRET')
  const keyFile = envValue(env, 'REPOSITORIES_GITHUB_APP_PRIVATE_KEY_FILE')
  const inlineKey = envValue(env, 'REPOSITORIES_GITHUB_APP_PRIVATE_KEY')?.replace(/\\n/g, '\n') ?? null
  const privateKey = inlineKey ?? (keyFile ? readFileSync(keyFile, 'utf8') : null)
  if (!appId || !slug || !clientId || !clientSecret || !privateKey) throw new GitHubAppError('not_configured')
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug)) throw new GitHubAppError('not_configured')
  return { appId, slug, clientId, clientSecret, privateKey }
}

function appJwt(appId: string, privateKey: string, nowSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId })}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  return `${unsigned}.${signer.sign(privateKey, 'base64url')}`
}

type RawRepository = { id?: unknown; full_name?: unknown; default_branch?: unknown; permissions?: { push?: unknown; admin?: unknown } }
type RawCommit = { sha?: unknown; html_url?: unknown; commit?: { message?: unknown; author?: { name?: unknown; date?: unknown } } }

function toGranted(value: RawRepository): GrantedRepository {
  if (typeof value.id !== 'number' || typeof value.full_name !== 'string' || typeof value.default_branch !== 'string') {
    throw new GitHubAppError('invalid_response')
  }
  return { id: String(value.id), fullName: value.full_name, defaultBranch: value.default_branch }
}

export function createGitHubApp(
  readConfig: () => GitHubAppConfig = () => readGitHubAppConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): GitHubApp {
  async function request<T>(url: string, init: { method?: string; token?: string; body?: unknown; accept?: string } = {}): Promise<T> {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: init.method ?? 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: init.accept ?? 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      })
    } catch {
      throw new GitHubAppError('unavailable')
    }
    if (response.status === 404 || response.status === 422) throw new GitHubAppError('not_granted')
    if (!response.ok) throw new GitHubAppError('unavailable')
    try {
      return await response.json() as T
    } catch {
      throw new GitHubAppError('invalid_response')
    }
  }

  const appToken = () => {
    const config = readConfig()
    return appJwt(config.appId, config.privateKey, Math.floor(Date.now() / 1000))
  }

  async function installationToken(installationId: string, repositoryIds?: string[]) {
    const result = await request<{ token?: unknown; expires_at?: unknown; repositories?: RawRepository[] }>(
      `${API_ORIGIN}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      { method: 'POST', token: appToken(), body: repositoryIds ? { repository_ids: repositoryIds.map(Number) } : {} },
    )
    if (typeof result.token !== 'string' || typeof result.expires_at !== 'string') throw new GitHubAppError('invalid_response')
    return { token: result.token, expiresAt: result.expires_at, repositories: result.repositories ?? [] }
  }

  async function paged<T>(url: (page: number) => string, token: string, pick: (body: unknown) => T[]): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      const batch = pick(await request<unknown>(url(page), { token }))
      items.push(...batch)
      if (batch.length < 100) return items
    }
    throw new GitHubAppError('invalid_response')
  }

  async function installationGrant(installationId: string): Promise<InstallationGrant> {
    const installation = await request<{ id?: unknown; account?: { login?: unknown } }>(
      `${API_ORIGIN}/app/installations/${encodeURIComponent(installationId)}`, { token: appToken() },
    )
    if (String(installation.id) !== installationId || typeof installation.account?.login !== 'string') throw new GitHubAppError('invalid_response')
    const { token } = await installationToken(installationId)
    const repositories = await paged(
      (page) => `${API_ORIGIN}/installation/repositories?per_page=100&page=${page}`,
      token,
      (body) => {
        const list = (body as { repositories?: unknown }).repositories
        if (!Array.isArray(list)) throw new GitHubAppError('invalid_response')
        return list.map((item) => toGranted(item as RawRepository))
      },
    )
    return { installationId, accountLogin: installation.account.login, repositories }
  }

  return {
    isConfigured() {
      try {
        readConfig()
        return true
      } catch {
        return false
      }
    },
    buildInstallUrl(state) {
      const url = new URL(`${WEB_ORIGIN}/apps/${readConfig().slug}/installations/new`)
      url.searchParams.set('state', state)
      return url.toString()
    },
    buildAuthorizeUrl(state) {
      const url = new URL(`${WEB_ORIGIN}/login/oauth/authorize`)
      url.searchParams.set('client_id', readConfig().clientId)
      url.searchParams.set('state', state)
      return url.toString()
    },
    async verifyInstallationConsent(installationId, code) {
      const config = readConfig()
      const exchanged = await request<{ access_token?: unknown }>(`${WEB_ORIGIN}/login/oauth/access_token`, {
        method: 'POST', accept: 'application/json', body: { client_id: config.clientId, client_secret: config.clientSecret, code },
      })
      if (typeof exchanged.access_token !== 'string' || !exchanged.access_token) throw new GitHubAppError('consent_refused')
      let writable: RawRepository[]
      try {
        writable = await paged(
          (page) => `${API_ORIGIN}/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100&page=${page}`,
          exchanged.access_token,
          (body) => {
            const list = (body as { repositories?: unknown }).repositories
            if (!Array.isArray(list)) throw new GitHubAppError('invalid_response')
            return list as RawRepository[]
          },
        )
      } catch (error) {
        // The user cannot see this installation: the callback's installation id is not theirs.
        if (error instanceof GitHubAppError && error.code === 'not_granted') throw new GitHubAppError('consent_refused')
        throw error
      }
      const authorizedRepositoryIds = writable
        .filter((item) => item.permissions?.push === true || item.permissions?.admin === true)
        .map((item) => String(item.id))
      const grant = await installationGrant(installationId)
      const authorized = new Set(authorizedRepositoryIds)
      return { ...grant, repositories: grant.repositories.filter((item) => authorized.has(item.id)), authorizedRepositoryIds }
    },
    async getInstallationGrant(installationId, authorizedRepositoryIds) {
      const grant = await installationGrant(installationId)
      const authorized = new Set(authorizedRepositoryIds)
      return { ...grant, repositories: grant.repositories.filter((item) => authorized.has(item.id)) }
    },
    async listBranches(installationId, githubRepositoryId) {
      const { token } = await installationToken(installationId, [githubRepositoryId])
      return paged(
        (page) => `${API_ORIGIN}/repositories/${encodeURIComponent(githubRepositoryId)}/branches?per_page=100&page=${page}`,
        token,
        (body) => {
          if (!Array.isArray(body)) throw new GitHubAppError('invalid_response')
          return body.map((item) => {
            const name = (item as { name?: unknown }).name
            if (typeof name !== 'string') throw new GitHubAppError('invalid_response')
            return name
          })
        },
      )
    },
    async repositoryToken(installationId, githubRepositoryId) {
      const issued = await installationToken(installationId, [githubRepositoryId])
      const repository = issued.repositories.find((item) => String(item.id) === githubRepositoryId)
      if (!repository) throw new GitHubAppError('not_granted')
      return { token: issued.token, fullName: toGranted(repository).fullName, expiresAt: issued.expiresAt }
    },
    async headCommit(installationId, githubRepositoryId, branch) {
      const { token } = await installationToken(installationId, [githubRepositoryId])
      // Addressed by repository id, like every other read here: the full name can change under us,
      // the id cannot.
      const commits = await request<unknown>(
        `${API_ORIGIN}/repositories/${encodeURIComponent(githubRepositoryId)}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
        { token },
      )
      if (!Array.isArray(commits)) throw new GitHubAppError('invalid_response')
      const head = commits[0] as RawCommit | undefined
      if (!head || typeof head.sha !== 'string') return null
      const message = typeof head.commit?.message === 'string' ? head.commit.message : ''
      return {
        sha: head.sha,
        subject: message.split('\n', 1)[0] ?? '',
        authorName: typeof head.commit?.author?.name === 'string' ? head.commit.author.name : null,
        committedAt: typeof head.commit?.author?.date === 'string' ? head.commit.author.date : null,
        htmlUrl: typeof head.html_url === 'string' ? head.html_url : null,
      }
    },
  }
}
