/**
 * The few GitHub REST calls the factory needs to open one PR with a handful of files:
 * read the base branch, build one commit on top of it (Git Data API), point a branch at
 * it and open (or reuse) the pull request. Token, repo and base branch come from the
 * environment; nothing here is tenant data.
 */

export type GitHubConfig = {
  token: string
  /** `owner/name` */
  repo: string
  baseBranch: string
  apiUrl: string
}

export type PullRequestRef = { number: number; htmlUrl: string; headSha: string }

/** `content: null` deletes the file. */
export type PullRequestFile = { filename: string; status: string; additions: number; deletions: number; patch: string | null }

export type CheckRun = { name: string; status: string; conclusion: string | null; url: string | null }

/** `content: null` deletes the file; `encoding: 'base64'` marks binary content (images). */
export type CommitFile = { path: string; content: string | null; encoding?: 'utf-8' | 'base64' }

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    body: string,
  ) {
    super(`GitHub ${status} on ${path}: ${body.slice(0, 300)}`)
    this.name = 'GitHubApiError'
  }
}

export const DEFAULT_SITE_REPO = 'jtomaszewski/hackaton-stal-zbiorniki-landing'

export function readGitHubConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubConfig {
  const token = env.FACTORY_GITHUB_TOKEN?.trim()
  if (!token) throw new Error('FACTORY_GITHUB_TOKEN is not set; the factory cannot open pull requests.')
  const repo = env.FACTORY_SITE_REPO?.trim() || DEFAULT_SITE_REPO
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`FACTORY_SITE_REPO must be owner/name, got "${repo}"`)
  return {
    token,
    repo,
    baseBranch: env.FACTORY_SITE_BASE_BRANCH?.trim() || 'main',
    apiUrl: env.FACTORY_GITHUB_API_URL?.trim() || 'https://api.github.com',
  }
}

export class GitHubClient {
  constructor(
    private readonly config: GitHubConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get repo(): string {
    return this.config.repo
  }

  get baseBranch(): string {
    return this.config.baseBranch
  }

  private async request<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | null> {
    const response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (response.status === 404 && allow404) return null
    const textBody = await response.text()
    if (!response.ok) throw new GitHubApiError(response.status, path, textBody)
    return textBody ? (JSON.parse(textBody) as T) : null
  }

  private repoPath(suffix: string): string {
    return `/repos/${this.config.repo}${suffix}`
  }

  async getBranchSha(branch: string): Promise<string | null> {
    const ref = await this.request<{ object: { sha: string } }>('GET', this.repoPath(`/git/ref/heads/${branch}`), undefined, true)
    return ref?.object.sha ?? null
  }

  async getCommitTreeSha(commitSha: string): Promise<string> {
    const commit = await this.request<{ tree: { sha: string } }>('GET', this.repoPath(`/git/commits/${commitSha}`))
    if (!commit) throw new Error(`Commit ${commitSha} not found`)
    return commit.tree.sha
  }

  /** One commit with every file, on top of `parentSha`. Returns the new commit sha. */
  async createCommit(params: { parentSha: string; files: CommitFile[]; message: string }): Promise<string> {
    const baseTree = await this.getCommitTreeSha(params.parentSha)
    // Inline tree content is UTF-8 only, so binary files go up as blobs first.
    const entries = await Promise.all(params.files.map(async (file) => {
      if (file.content === null) return { path: file.path, mode: '100644', type: 'blob', sha: null }
      if (file.encoding !== 'base64') return { path: file.path, mode: '100644', type: 'blob', content: file.content }
      const blob = await this.request<{ sha: string }>('POST', this.repoPath('/git/blobs'), { content: file.content, encoding: 'base64' })
      return { path: file.path, mode: '100644', type: 'blob', sha: blob!.sha }
    }))
    const tree = await this.request<{ sha: string }>('POST', this.repoPath('/git/trees'), { base_tree: baseTree, tree: entries })
    const commit = await this.request<{ sha: string }>('POST', this.repoPath('/git/commits'), {
      message: params.message,
      tree: tree!.sha,
      parents: [params.parentSha],
    })
    return commit!.sha
  }

  /** Creates the branch, or moves it when it already exists (a stale branch from an earlier try). */
  async upsertBranch(branch: string, sha: string): Promise<void> {
    const existing = await this.getBranchSha(branch)
    if (existing === sha) return
    if (existing) {
      await this.request('PATCH', this.repoPath(`/git/refs/heads/${branch}`), { sha, force: true })
      return
    }
    await this.request('POST', this.repoPath('/git/refs'), { ref: `refs/heads/${branch}`, sha })
  }

  async findOpenPullRequest(branch: string): Promise<PullRequestRef | null> {
    const owner = this.config.repo.split('/')[0]
    const list = await this.request<Array<{ number: number; html_url: string; head: { sha: string } }>>(
      'GET',
      this.repoPath(`/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`),
    )
    const first = list?.[0]
    return first ? { number: first.number, htmlUrl: first.html_url, headSha: first.head.sha } : null
  }

  async createPullRequest(params: { title: string; body: string; head: string }): Promise<PullRequestRef> {
    const pr = await this.request<{ number: number; html_url: string; head: { sha: string } }>('POST', this.repoPath('/pulls'), {
      title: params.title,
      body: params.body,
      head: params.head,
      base: this.config.baseBranch,
    })
    return { number: pr!.number, htmlUrl: pr!.html_url, headSha: pr!.head.sha }
  }

  async getPullRequest(number: number): Promise<{ number: number; state: 'open' | 'closed'; merged: boolean; htmlUrl: string; headSha: string } | null> {
    const pr = await this.request<{ number: number; state: 'open' | 'closed'; merged: boolean; html_url: string; head: { sha: string } }>(
      'GET', this.repoPath(`/pulls/${number}`), undefined, true,
    )
    return pr ? { number: pr.number, state: pr.state, merged: pr.merged, htmlUrl: pr.html_url, headSha: pr.head.sha } : null
  }

  /** Changed files with unified-diff patches (GitHub omits `patch` for binary or huge files). */
  async listPullRequestFiles(number: number): Promise<PullRequestFile[]> {
    const files = await this.request<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>>(
      'GET', this.repoPath(`/pulls/${number}/files?per_page=100`),
    )
    return (files ?? []).map((file) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch: file.patch ?? null }))
  }

  async listCheckRuns(sha: string): Promise<CheckRun[]> {
    const result = await this.request<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string | null }> }>(
      'GET', this.repoPath(`/commits/${sha}/check-runs?per_page=50`),
    )
    return (result?.check_runs ?? []).map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion, url: run.html_url }))
  }

  /** The newest successful deployment's URL for `sha` (Vercel posts one per PR commit), or null. */
  async findPreviewUrl(sha: string): Promise<string | null> {
    const deployments = await this.request<Array<{ id: number }>>('GET', this.repoPath(`/deployments?sha=${sha}&per_page=5`))
    for (const deployment of deployments ?? []) {
      const statuses = await this.request<Array<{ state: string; environment_url?: string | null; target_url?: string | null }>>(
        'GET', this.repoPath(`/deployments/${deployment.id}/statuses?per_page=5`),
      )
      const success = (statuses ?? []).find((status) => status.state === 'success')
      const url = success?.environment_url || success?.target_url
      if (url && /^https:\/\//.test(url)) return url
    }
    return null
  }

  /**
   * Squash-merges the PR at exactly `headSha`, so a commit pushed after the approval is never
   * merged unseen. GitHub refuses (405/409) while required checks are red or the head moved.
   */
  async mergePullRequest(number: number, headSha: string): Promise<void> {
    await this.request('PUT', this.repoPath(`/pulls/${number}/merge`), { merge_method: 'squash', sha: headSha })
  }
}

/** The PR number of a URL on `repo`, or null for any other repository. */
export function pullRequestNumberFromUrl(url: string | null | undefined, repo: string): number | null {
  if (!url) return null
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?$/.exec(url)
  if (!match || match[1]!.toLowerCase() !== repo.toLowerCase()) return null
  return Number(match[2])
}
