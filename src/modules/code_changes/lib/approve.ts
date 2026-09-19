import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TaskDelegationService } from '../../task_delegation/lib/delegationService'
import { requireTaskScope } from '../../task_delegation/lib/auth'
import { GitHubApiError, pullRequestNumberFromUrl, type GitHubClient } from './github'

export type ApproveResult = { taskId: string; prUrl: string; merged: true; alreadyMerged: boolean }

type TaskRow = { id: string; time_project_id: string; task_status_id: string; assignee_staff_member_id: string | null }

async function refuse(status: number, code: string, key: string, fallback: string): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(status, { code, error: translate(key, fallback) })
}

/**
 * Marek's „zatwierdź” (SPEC-004 scene 3): merges the PR the delegated run linked on the task and
 * closes the task as Done. Every precondition is checked before the merge, because the merge is
 * the one step that cannot be undone: task access, an active delegation with a PR on the
 * project's site repo, the task In review, and the caller as its accountable assignee. The
 * merge is pinned to the PR head the check saw; Done then goes through staff's status change,
 * which the tasks guard turns into a release with outcome `done`.
 */
export async function approveTaskPullRequest(ctx: CommandRuntimeContext, taskId: string, githubFor: (projectId: string) => Promise<GitHubClient>): Promise<ApproveResult> {
  const scope = await requireTaskScope(ctx)
  const service = ctx.container.resolve<TaskDelegationService>('taskDelegationService')
  const [item] = await service.getDelegations(ctx, [taskId])
  if (!item) throw await refuse(404, 'task_not_found', 'code_changes.approve.errors.notFound', 'Task not found.')
  const delegation = item.delegation
  if (!delegation || delegation.releasedAt) {
    throw await refuse(409, 'not_delegated', 'code_changes.approve.errors.notDelegated', 'The task is not delegated to an agent.')
  }
  const prLink = [...delegation.links].reverse().find((link) => link.kind === 'pr')
  if (!prLink?.url) throw await refuse(409, 'no_pull_request', 'code_changes.approve.errors.noPullRequest', 'The task has no website pull request yet.')
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
  const done = statuses.items.find((status) => status.slug === 'done')
  if (current !== 'in-review' || !done) throw await refuse(409, 'not_in_review', 'code_changes.approve.errors.notInReview', 'Only a task in review can be approved.')
  const members = task.assignee_staff_member_id
    ? await qe.query<{ id: string; user_id: string | null }>('staff:staff_team_member', {
      fields: ['id', 'user_id'], filters: { id: task.assignee_staff_member_id }, page: { page: 1, pageSize: 1 },
      tenantId: scope.tenantId, organizationId: scope.organizationId,
    })
    : { items: [] }
  if (members.items[0]?.user_id !== scope.userId) {
    throw await refuse(403, 'assignee_required', 'code_changes.approve.errors.assigneeOnly', 'Only the task assignee can approve the pull request.')
  }

  const pr = await github.getPullRequest(prNumber)
  if (!pr) throw await refuse(409, 'no_pull_request', 'code_changes.approve.errors.noPullRequest', 'The task has no website pull request yet.')
  const alreadyMerged = pr.merged
  if (!pr.merged) {
    if (pr.state === 'closed') throw await refuse(409, 'pr_closed', 'code_changes.approve.errors.prClosed', 'The pull request was closed without merging.')
    try {
      await github.mergePullRequest(pr.number, pr.headSha)
    } catch (error) {
      if (error instanceof GitHubApiError && [405, 409, 422].includes(error.status)) {
        throw await refuse(409, 'merge_blocked', 'code_changes.approve.errors.mergeBlocked', 'GitHub refused the merge: checks are not green or the pull request changed. Review it again.')
      }
      throw error
    }
  }

  await ctx.container.resolve<CommandBus>('commandBus').execute('staff.timesheets.tasks.status_change', {
    input: { id: taskId, taskStatusId: done.id }, ctx,
  })
  return { taskId, prUrl: pr.htmlUrl, merged: true, alreadyMerged }
}
