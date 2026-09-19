import { beforeEach, expect, it, jest } from '@jest/globals'
import { buildDeveloperPrompt, deliverWithDeveloper, developerBranch, pullRequestSummary } from '../lib/developer'

const task = { id: 'abcdef12-0000-4000-8000-000000000001', title: 'Opublikuj stronę produktu ZWM-1500', description: 'Produkt: /backend/catalog/products/x' }
const config = { image: 'img', model: 'anthropic/x', timeoutMs: 1, repo: 'o/site', baseBranch: 'main', modelEnv: { ANTHROPIC_API_KEY: 'k' } }
const github = {
  findOpenPullRequest: jest.fn<(branch: string) => Promise<unknown>>(),
  createCommit: jest.fn<(params: unknown) => Promise<string>>(),
  upsertBranch: jest.fn<(branch: string, sha: string) => Promise<void>>(),
  createPullRequest: jest.fn<(params: { title: string; body: string; head: string }) => Promise<unknown>>(),
}
const run = jest.fn<(...args: unknown[]) => Promise<unknown>>()

beforeEach(() => {
  github.findOpenPullRequest.mockReset().mockResolvedValue(null)
  github.createCommit.mockReset().mockResolvedValue('commit-sha')
  github.upsertBranch.mockReset().mockResolvedValue(undefined)
  github.createPullRequest.mockReset().mockResolvedValue({ number: 9, htmlUrl: 'https://github.com/o/site/pull/9', headSha: 'commit-sha' })
  run.mockReset().mockResolvedValue({ baseSha: 'base-sha', summary: 'Dodałem stronę.', durationMs: 90_000, files: [{ path: 'app/a.tsx', content: 'x' }, { path: 'old.ts', content: null }] })
})

it('commits the agent’s files on the exact base it cloned and opens one PR per task', async () => {
  const result = await deliverWithDeveloper({ github: github as never, config, run: run as never }, task, null)
  expect(github.createCommit).toHaveBeenCalledWith({ parentSha: 'base-sha', files: [{ path: 'app/a.tsx', content: 'x' }, { path: 'old.ts', content: null }], message: task.title })
  expect(github.upsertBranch).toHaveBeenCalledWith('developer/task-abcdef12', 'commit-sha')
  expect(github.createPullRequest.mock.calls[0]![0].body).toContain('Dodałem stronę.')
  expect(result).toEqual({ prNumber: 9, prUrl: 'https://github.com/o/site/pull/9', prLabel: `PR #9 · ${task.title}`, branch: developerBranch(task.id), reused: false })
})

it('reuses the task’s open PR without running the agent again', async () => {
  github.findOpenPullRequest.mockResolvedValue({ number: 4, htmlUrl: 'https://github.com/o/site/pull/4', headSha: 'h' })
  await expect(deliverWithDeveloper({ github: github as never, config, run: run as never }, task, null)).resolves.toMatchObject({ prNumber: 4, reused: true })
  expect(run).not.toHaveBeenCalled()
})

it('puts the task and the catalog record in the prompt', () => {
  const prompt = buildDeveloperPrompt(task, { id: 'p', sku: 'ZWM-1500', title: 'Zbiornik' } as never)
  expect(prompt).toContain(task.title)
  expect(prompt).toContain('"sku": "ZWM-1500"')
  expect(prompt).toContain('AGENTS.md')
  expect(buildDeveloperPrompt(task, null)).not.toContain('Catalog record')
})

it('keeps only the summary when the agent adds a preamble', () => {
  expect(pullRequestSummary('Perfect! All tasks completed.\n\n## Podsumowanie\n\nDodano stronę ZWM-1500.')).toBe('Dodano stronę ZWM-1500.')
  expect(pullRequestSummary('Dodano stronę ZWM-1500.')).toBe('Dodano stronę ZWM-1500.')
})
