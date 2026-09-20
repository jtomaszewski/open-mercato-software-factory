import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TaskDelegationService } from '../../task_delegation/lib/delegationService'
import { requireTaskScope } from '../../task_delegation/lib/auth'
import { GitHubApiError, pullRequestNumberFromUrl, type GitHubClient } from './github'

export type ApproveResult = { taskId: string; prUrl: string; merged: true; alreadyMerged: boolean; mergeCommitSha: string | null }
export type RejectResult = { taskId: string; prUrl: string; closed: true; alreadyClosed: boolean }

type TaskRow = { id: string; time_project_id: string; task_status_id: string; assignee_staff_member_id: string | null }

async function refuse(status: number, code: string, key: string, fallback: string): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(status, { code, error: translate(key, fallback) })
}

type Decision = {
  taskId: string
  github: GitHubClient
  prNumber: number
  /** The board status a decision moves the task to: `done` approves, `backlog` rejects. */
  statusId: (slug: 'done' | 'backlog') => string | null
}

/**
 * Everything both decisions need, checked before either of them touches GitHub.
 *
 * Approving merges and rejecting closes, and neither is something to discover a missing
 * precondition halfway through: task access, an active delegation carrying a PR on the project's
 * repository, the task In review, and the caller as its accountable assignee are all established
 * here, once, for both paths.
 */
async function resolveDecision(ctx: CommandRuntimeContext, taskId: string, githubFor: (projectId: string) => Promise<GitHubClient>): Promise<Decision> {
  const scope = await requireTaskScope(ctx)
  const service = ctx.container.resolve<TaskDelegationService>('taskDelegationService')
  const [item] = await service.getDelegations(ctx, [taskId])
  if (!item) throw await refuse(404, 'task_not_found', 'code_changes.approve.errors.notFound', 'Task not found.')
  const delegation = item.delegation
  if (!delegation || delegation.releasedAt) {
    throw await refuse(409, 'not_delegated', 'code_changes.approve.errors.notDelegated', 'The task is not delegated to an agent.')
  }
  const prLink = [...delegation.links].reverse().find((link) => link.kind === 'pr')
  const github = await githubFor(item.projectId)
  const prNumber = pullRequestNumberFromUrl(prLink?.url, github.repo)
  if (!prLink?.url || !prNumber) throw await refuse(409, 'no_pull_request', 'code_changes.approve.errors.noPullRequest', 'The task has no website pull request yet.')

  const qe = ctx.container.resolve<QueryEngine>('queryEngine')
  const tasks = await qe.query<TaskRow>('staff:staff_time_task', {
    fields: ['id', 'time_project_id', 'task_status_id', 'assignee_staff_member_id'], filters: { id: taskId }, page: { page: 1, pageSize: 1 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  const task = tasks.items[0]
  if (!task) throw await refuse(404, 'task_not_found', 'code_changes.approve.errors.notFound', 'Task not found.')
  const statuses = await qe.query<{ id: string; slug: string }>('staff:staff_time_task_status', {
    fields: ['id', 'slug'], filters: { time_project_id: task.time_project_id }, page: { page: 1, pageSize: 100 },
    tenantId: scope.tenantId, organizationId: scope.organizationId,
  })
  const current = statuses.items.find((status) => status.id === task.task_status_id)?.slug
  if (current !== 'in-review') throw await refuse(409, 'not_in_review', 'code_changes.approve.errors.notInReview', 'Only a task in review can be approved.')
  const members = task.assignee_staff_member_id
    ? await qe.query<{ id: string; user_id: string | null }>('staff:staff_team_member', {
      fields: ['id', 'user_id'], filters: { id: task.assignee_staff_member_id }, page: { page: 1, pageSize: 1 },
      tenantId: scope.tenantId, organizationId: scope.organizationId,
    })
    : { items: [] }
  if (members.items[0]?.user_id !== scope.userId) {
    throw await refuse(403, 'assignee_required', 'code_changes.approve.errors.assigneeOnly', 'Only the task assignee can approve the pull request.')
  }
  return {
    taskId,
    github,
    prNumber,
    statusId: (slug) => statuses.items.find((status) => status.slug === slug)?.id ?? null,
  }
}

/**
 * Marek's „zatwierdź” (SPEC-004 scene 3): merges the PR the delegated run linked on the task and
 * closes the task as Done. The merge is pinned to the PR head the check saw; Done then goes
 * through staff's status change, which the tasks guard turns into a release with outcome `done`.
 */
export async function approveTaskPullRequest(ctx: CommandRuntimeContext, taskId: string, githubFor: (projectId: string) => Promise<GitHubClient>): Promise<ApproveResult> {
  const decision = await resolveDecision(ctx, taskId, githubFor)
  const done = decision.statusId('done')
  if (!done) throw await refuse(409, 'not_in_review', 'code_changes.approve.errors.notInReview', 'Only a task in review can be approved.')
  const pr = await decision.github.getPullRequest(decision.prNumber)
  if (!pr) throw await refuse(409, 'no_pull_request', 'code_changes.approve.errors.noPullRequest', 'The task has no website pull request yet.')
  const alreadyMerged = pr.merged
  let mergeCommitSha: string | null = null
  if (!pr.merged) {
    if (pr.state === 'closed') throw await refuse(409, 'pr_closed', 'code_changes.approve.errors.prClosed', 'The pull request was closed without merging.')
    try {
      mergeCommitSha = (await decision.github.mergePullRequest(pr.number, pr.headSha)).sha
    } catch (error) {
      if (error instanceof GitHubApiError && [405, 409, 422].includes(error.status)) {
        throw await refuse(409, 'merge_blocked', 'code_changes.approve.errors.mergeBlocked', 'GitHub refused the merge: checks are not green or the pull request changed. Review it again.')
      }
      throw error
    }
  }

  await ctx.container.resolve<CommandBus>('commandBus').execute('staff.timesheets.tasks.status_change', {
    input: { id: taskId, taskStatusId: done }, ctx,
  })
  return { taskId, prUrl: pr.htmlUrl, merged: true, alreadyMerged, mergeCommitSha }
}

/**
 * The other half of the decision: the change is not wanted. The pull request is closed without
 * merging and the task goes back to Backlog, which the tasks guard turns into a release with
 * outcome `rejected` — the task stays, with its person, ready to be asked for again.
 *
 * An already-merged PR is refused rather than "unmerged": undoing a shipped change is a revert,
 * a different decision with different consequences, and pretending otherwise here would lose it.
 */
export async function rejectTaskPullRequest(ctx: CommandRuntimeContext, taskId: string, githubFor: (projectId: string) => Promise<GitHubClient>): Promise<RejectResult> {
  const decision = await resolveDecision(ctx, taskId, githubFor)
  const backlog = decision.statusId('backlog')
  if (!backlog) throw await refuse(409, 'not_in_review', 'code_changes.reject.errors.noBacklog', 'The project has no backlog column to return the task to.')
  const pr = await decision.github.getPullRequest(decision.prNumber)
  if (!pr) throw await refuse(409, 'no_pull_request', 'code_changes.approve.errors.noPullRequest', 'The task has no website pull request yet.')
  if (pr.merged) throw await refuse(409, 'pr_merged', 'code_changes.reject.errors.alreadyMerged', 'This change is already published and can no longer be rejected.')
  const alreadyClosed = pr.state === 'closed'
  if (!alreadyClosed) await decision.github.closePullRequest(pr.number)

  await ctx.container.resolve<CommandBus>('commandBus').execute('staff.timesheets.tasks.status_change', {
    input: { id: taskId, taskStatusId: backlog }, ctx,
  })
  return { taskId, prUrl: pr.htmlUrl, closed: true, alreadyClosed }
}
