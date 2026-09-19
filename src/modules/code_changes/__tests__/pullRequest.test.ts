import { beforeEach, expect, it, jest } from '@jest/globals'
import { openTaskPullRequest, pullRequestSummary, taskBranch } from '../lib/pullRequest'

const task = { id: 'abcdef12-0000-4000-8000-000000000001', title: 'Opublikuj stronę produktu ZWM-1500', description: 'Produkt: /backend/catalog/products/x' }
const change = { baseSha: 'base-sha', summary: 'Dodałem stronę.', files: [{ path: 'app/a.tsx', content: 'x' }, { path: 'old.ts', content: null }] }
const github = {
  createCommit: jest.fn<(params: unknown) => Promise<string>>(),
  upsertBranch: jest.fn<(branch: string, sha: string) => Promise<void>>(),
  createPullRequest: jest.fn<(params: { title: string; body: string; head: string }) => Promise<unknown>>(),
}
const deps = { github: github as never, agentLabel: 'agent Developer', appUrl: 'http://localhost:3000/' }

beforeEach(() => {
  github.createCommit.mockReset().mockResolvedValue('commit-sha')
  github.upsertBranch.mockReset().mockResolvedValue(undefined)
  github.createPullRequest.mockReset().mockResolvedValue({ number: 9, htmlUrl: 'https://github.com/o/site/pull/9', headSha: 'commit-sha' })
})

it('commits the agent’s files on the exact base it was given and opens one PR per task', async () => {
  const result = await openTaskPullRequest(deps, task, change)
  expect(github.createCommit).toHaveBeenCalledWith({ parentSha: 'base-sha', files: change.files, message: task.title })
  expect(github.upsertBranch).toHaveBeenCalledWith('developer/task-abcdef12', 'commit-sha')
  const body = github.createPullRequest.mock.calls[0]![0].body
  expect(body).toContain('Dodałem stronę.')
  expect(body).toContain('agent Developer')
  expect(body).toContain('`old.ts` (usunięty)')
  expect(body).toContain('http://localhost:3000/backend/staff/time-tracking')
  expect(result).toEqual({ prNumber: 9, prUrl: 'https://github.com/o/site/pull/9', prLabel: `PR #9 · ${task.title}`, branch: taskBranch(task.id) })
})

it('falls back to a generic description when the agent gave no summary', async () => {
  await openTaskPullRequest(deps, task, { ...change, summary: '' })
  expect(github.createPullRequest.mock.calls[0]![0].body).toContain('Zmiana przygotowana przez: agent Developer.')
})

it('keeps only the summary when the agent adds a preamble', () => {
  expect(pullRequestSummary('Perfect! All tasks completed.\n\n## Podsumowanie\n\nDodano stronę ZWM-1500.')).toBe('Dodano stronę ZWM-1500.')
  expect(pullRequestSummary('Dodano stronę ZWM-1500.')).toBe('Dodano stronę ZWM-1500.')
})
