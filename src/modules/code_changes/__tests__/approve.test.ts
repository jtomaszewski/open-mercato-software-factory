import { beforeEach, expect, it, jest } from '@jest/globals'
import { approveTaskPullRequest } from '../lib/approve'
import { GitHubApiError, pullRequestNumberFromUrl } from '../lib/github'

const REPO = 'jtomaszewski/hackaton-stal-zbiorniki-landing'
const PR_URL = `https://github.com/${REPO}/pull/8`
const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const getPullRequest = jest.fn<(n: number) => Promise<unknown>>()
const mergePullRequest = jest.fn<(n: number, sha: string) => Promise<{ sha: string | null }>>()
let delegation: Record<string, unknown> | null
let statusSlug: string
let assigneeUserId: string

const githubFor = jest.fn(async (_projectId: string) => ({ repo: REPO, getPullRequest, mergePullRequest }) as never)
function ctx() {
  const services: Record<string, unknown> = {
    taskDelegationService: { getDelegations: async () => [{ taskId: 'task-1', projectId: 'project-1', taskUpdatedAt: 'v', delegation }] },
    commandBus: { execute },
    queryEngine: {
      query: async (entity: string) => {
        if (entity === 'staff:staff_time_task') return { items: [{ id: 'task-1', time_project_id: 'p', task_status_id: 'current', assignee_staff_member_id: 'member-1' }] }
        if (entity === 'staff:staff_time_task_status') return { items: [{ id: 'current', slug: statusSlug }, { id: 'done-id', slug: 'done' }] }
        if (entity === 'staff:staff_team_member') return { items: [{ id: 'member-1', user_id: assigneeUserId }] }
        return { items: [] }
      },
    },
  }
  return {
    container: { resolve: (name: string) => services[name] },
    auth: { sub: 'marek', tenantId: 't', orgId: 'o' }, selectedOrganizationId: 'o', organizationIds: ['o'], organizationScope: null,
  } as never
}

beforeEach(() => {
  delegation = { releasedAt: null, links: [{ kind: 'pr', ref: 'PR #8', url: PR_URL }] }
  statusSlug = 'in-review'
  assigneeUserId = 'marek'
  execute.mockReset().mockResolvedValue({ result: {} })
  getPullRequest.mockReset().mockResolvedValue({ number: 8, state: 'open', merged: false, htmlUrl: PR_URL, headSha: 'abc' })
  mergePullRequest.mockReset().mockResolvedValue({ sha: 'merge-sha' })
})

it('merges the PR at the head it checked and closes the task as Done', async () => {
  await expect(approveTaskPullRequest(ctx(), 'task-1', githubFor)).resolves.toEqual({ taskId: 'task-1', prUrl: PR_URL, merged: true, alreadyMerged: false, mergeCommitSha: 'merge-sha' })
  expect(mergePullRequest).toHaveBeenCalledWith(8, 'abc')
  expect(githubFor).toHaveBeenCalledWith('project-1')
  expect(execute).toHaveBeenCalledWith('staff.timesheets.tasks.status_change', expect.objectContaining({ input: { id: 'task-1', taskStatusId: 'done-id' } }))
})

it('finishes a retry after an earlier merge without merging again', async () => {
  getPullRequest.mockResolvedValue({ number: 8, state: 'closed', merged: true, htmlUrl: PR_URL, headSha: 'abc' })
  await expect(approveTaskPullRequest(ctx(), 'task-1', githubFor)).resolves.toMatchObject({ alreadyMerged: true })
  expect(mergePullRequest).not.toHaveBeenCalled()
  expect(execute).toHaveBeenCalled()
})

it.each([
  ['someone other than the assignee', () => { assigneeUserId = 'someone-else' }, 'assignee_required'],
  ['a task not in review', () => { statusSlug = 'in-progress' }, 'not_in_review'],
  ['a released delegation', () => { delegation = { releasedAt: '2026-09-19', links: [] } }, 'not_delegated'],
  ['a PR on another repository', () => { delegation = { releasedAt: null, links: [{ kind: 'pr', ref: 'x', url: 'https://github.com/evil/repo/pull/1' }] } }, 'no_pull_request'],
])('refuses %s before touching GitHub', async (_label, arrange, code) => {
  arrange()
  await expect(approveTaskPullRequest(ctx(), 'task-1', githubFor)).rejects.toMatchObject({ body: { code } })
  expect(getPullRequest).not.toHaveBeenCalled()
  expect(mergePullRequest).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('reports a merge GitHub refuses and leaves the task in review', async () => {
  mergePullRequest.mockRejectedValue(new GitHubApiError(405, '/merge', 'Required status check "site" is failing'))
  await expect(approveTaskPullRequest(ctx(), 'task-1', githubFor)).rejects.toMatchObject({ status: 409, body: { code: 'merge_blocked' } })
  expect(execute).not.toHaveBeenCalled()
})

it('reads PR numbers only from the configured repository', () => {
  expect(pullRequestNumberFromUrl(PR_URL, REPO)).toBe(8)
  expect(pullRequestNumberFromUrl(`${PR_URL}/`, REPO.toUpperCase())).toBe(8)
  expect(pullRequestNumberFromUrl('https://github.com/other/repo/pull/8', REPO)).toBeNull()
  expect(pullRequestNumberFromUrl(`${PR_URL}/files`, REPO)).toBeNull()
})
