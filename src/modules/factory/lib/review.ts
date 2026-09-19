import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TaskDelegationService } from '../../task_delegation/lib/delegationService'
import { pullRequestNumberFromUrl, type CheckRun, type GitHubClient, type PullRequestFile } from './github'

export type TaskReview = {
  taskId: string
  delegationActive: boolean
  pr: { number: number; url: string; state: 'open' | 'closed'; merged: boolean; headSha: string }
  previewUrl: string | null
  checks: CheckRun[]
  files: PullRequestFile[]
}

/**
 * What Marek reviews in the task drawer (execution spec EX-P0): the factory PR's changed files
 * with their patches, the checks on its head commit and the preview deployment. Read through the
 * tasks delegation service, so the caller's task access applies; only the configured site repo's
 * PRs are read. Null when the task has no factory PR yet.
 */
export async function readTaskReview(ctx: CommandRuntimeContext, taskId: string, githubSource: GitHubClient | (() => GitHubClient)): Promise<TaskReview | null> {
  const service = ctx.container.resolve<TaskDelegationService>('taskDelegationService')
  const [item] = await service.getDelegations(ctx, [taskId])
  if (!item) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(404, { code: 'task_not_found', error: translate('factory.approve.errors.notFound', 'Task not found.') })
  }
  const delegation = item.delegation
  if (!delegation || delegation.repositoryId) return null
  const github = typeof githubSource === 'function' ? githubSource() : githubSource
  const link = delegation ? [...delegation.links].reverse().find((entry) => entry.kind === 'pr') : undefined
  const number = pullRequestNumberFromUrl(link?.url, github.repo)
  if (!delegation || !number) return null
  const pr = await github.getPullRequest(number)
  if (!pr) return null
  const [files, checks, previewUrl] = await Promise.all([
    github.listPullRequestFiles(number),
    github.listCheckRuns(pr.headSha),
    github.findPreviewUrl(pr.headSha).catch(() => null),
  ])
  return {
    taskId,
    delegationActive: !delegation.releasedAt,
    pr: { number: pr.number, url: pr.htmlUrl, state: pr.state, merged: pr.merged, headSha: pr.headSha },
    previewUrl,
    checks,
    files,
  }
}
