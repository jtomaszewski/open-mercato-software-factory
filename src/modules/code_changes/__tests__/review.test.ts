import { expect, it, jest } from '@jest/globals'
import { readTaskReview } from '../lib/review'

const REPO = 'o/site'
function ctx(delegation: unknown) {
  return { container: { resolve: () => ({ getDelegations: async () => [{ taskId: 't', projectId: 'project-1', taskUpdatedAt: 'v', delegation }] }) } } as never
}
const github = {
  repo: REPO,
  getPullRequest: jest.fn(async () => ({ number: 3, state: 'open', merged: false, htmlUrl: `https://github.com/${REPO}/pull/3`, headSha: 'head' })),
  listPullRequestFiles: jest.fn(async () => [{ filename: 'app/a.tsx', status: 'added', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+a\n+b' }]),
  listCheckRuns: jest.fn(async (_sha: string) => [{ name: 'site', status: 'completed', conclusion: 'success', url: null }]),
  findPreviewUrl: jest.fn(async () => 'https://preview.example'),
}
const githubFor = jest.fn(async (_projectId: string) => github as never)

it('returns the PR files, checks and preview of the task’s PR', async () => {
  const review = await readTaskReview(ctx({ releasedAt: null, links: [{ kind: 'pr', url: `https://github.com/${REPO}/pull/3` }] }), 't', githubFor)
  expect(review).toMatchObject({ delegationActive: true, pr: { number: 3, headSha: 'head' }, previewUrl: 'https://preview.example', checks: [{ name: 'site' }], files: [{ filename: 'app/a.tsx' }] })
  expect(github.listCheckRuns).toHaveBeenCalledWith('head')
  expect(githubFor).toHaveBeenCalledWith('project-1')
})

it('reads nothing for a task without a PR on the project repository', async () => {
  github.getPullRequest.mockClear()
  await expect(readTaskReview(ctx({ releasedAt: null, links: [{ kind: 'pr', url: 'https://github.com/evil/repo/pull/3' }] }), 't', githubFor)).resolves.toBeNull()
  await expect(readTaskReview(ctx(null), 't', githubFor)).resolves.toBeNull()
  expect(github.getPullRequest).not.toHaveBeenCalled()
})
