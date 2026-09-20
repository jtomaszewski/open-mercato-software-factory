import type { AwilixContainer } from 'awilix'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { GitHubClient, type GitHubConfig } from './github'
import { resolveTaskGitHub, type TaskGitHub } from './github-source'
import { collectChanges, prepareCheckout, readCheckoutConfigFromEnv, removeCheckout, type CollectedChange, type PreparedCheckout } from './checkout'
import { openTaskPullRequest, type DelegatedTask, type OpenedPullRequest, type TaskChange } from './pullRequest'
import { bindRun, closeOnFailure, type Scope } from './run'

const logger = createLogger('code_changes').child({ component: 'functions' })

/**
 * The two workflow functions a coding workflow wraps its agent step with: check out the task
 * project's repository before, turn the working tree into a pull request after. The workflow
 * (and its agent) belong to the module that owns the kind of work; see `website_publishing`.
 */
export const PREPARE_CHECKOUT_FUNCTION = 'code_changes.prepare_checkout'
export const OPEN_PULL_REQUEST_FUNCTION = 'code_changes.open_pull_request'

/** What `prepare_checkout` returns to the workflow context, for the agent step's input. */
export type PreparedTask = {
  taskId: string
  title: string
  description: string
  /** The checkout as the OpenCode sidecar sees it. */
  workDir: string
  baseSha: string
}

export type CodeChangeDeps = {
  resolveContainer: () => Promise<AwilixContainer>
  /** The task project's repository and token (registered repository, else the env). */
  resolveGitHub: (container: AwilixContainer, scope: Scope, projectId: string) => Promise<TaskGitHub>
  prepareCheckout: (taskId: string, github: GitHubConfig) => Promise<PreparedCheckout>
  collectChanges: (taskId: string) => Promise<CollectedChange>
  removeCheckout: (taskId: string) => Promise<void>
  openPullRequest: (task: DelegatedTask, change: TaskChange, github: GitHubConfig, agentLabel: string) => Promise<OpenedPullRequest>
}

const defaultDeps: CodeChangeDeps = {
  resolveContainer: () => createRequestContainer(),
  resolveGitHub: (container, scope, projectId) => resolveTaskGitHub(container, scope, projectId),
  prepareCheckout: (taskId, github) =>
    prepareCheckout({ ...readCheckoutConfigFromEnv(), repo: github.repo, baseBranch: github.baseBranch }, taskId, undefined, github.token),
  collectChanges: (taskId) => collectChanges(readCheckoutConfigFromEnv(), taskId),
  removeCheckout: (taskId) => removeCheckout(readCheckoutConfigFromEnv(), taskId),
  openPullRequest: (task, change, github, agentLabel) => openTaskPullRequest({
    github: new GitHubClient(github),
    agentLabel,
    appUrl: process.env.APP_URL ?? null,
  }, task, change),
}

/** A workflow argument, unless the engine left its `{{…}}` template unresolved. */
function textArg(value: unknown): string {
  return typeof value === 'string' && !value.startsWith('{{') ? value : ''
}

/**
 * `EXECUTE_FUNCTION` handler of `code_changes.prepare_checkout`: the task goes In progress and the
 * project's repository is cloned into the run sandbox.
 */
export function createPrepareCheckoutFunction(deps: CodeChangeDeps = defaultDeps) {
  return async (_args: Record<string, unknown>, context: ActivityContext): Promise<PreparedTask> => {
    const bound = await bindRun(PREPARE_CHECKOUT_FUNCTION, context, deps.resolveContainer)
    await bound.run('task_delegation.task.set_status', `${PREPARE_CHECKOUT_FUNCTION}:in_progress`, { status: 'in_progress' })
    return closeOnFailure(bound, PREPARE_CHECKOUT_FUNCTION, async () => {
      const github = await deps.resolveGitHub(bound.container, bound.scope, bound.projectId)
      // The change request exists from here on, so a run that dies mid-way is still visible as a
      // change someone asked for and did not get, rather than as nothing at all.
      // The command bus answers with an envelope; the change request is its `result`.
      const started = await bound.run('code_changes.change_request.start', `${PREPARE_CHECKOUT_FUNCTION}:change_request`, {
        projectId: bound.projectId,
        title: bound.task.title,
        repoFullName: github.repo,
        baseBranch: github.baseBranch,
        repositoryId: github.repositoryId,
      }) as { result?: { id?: string } } | null
      const changeRequestId = started?.result?.id
      // The task drawer offers one thing to do while the agent works: open the change and watch it
      // happen. The link goes on the delegation, so the drawer renders it without knowing this
      // module exists — `task_delegation` shows the links its run carries, whoever wrote them.
      // Best effort: a link nobody could write is a missing button, not a reason to fail the run.
      if (changeRequestId) {
        await bound.run('task_delegation.task.link', `${PREPARE_CHECKOUT_FUNCTION}:change_link`, {
          kind: 'change', ref: bound.task.title, url: `/backend/code/changes/${changeRequestId}`,
        }).catch((linkError: unknown) => logger.warn('could not link the change request to the task', {
          taskId: bound.task.id, error: linkError instanceof Error ? linkError.message : String(linkError),
        }))
      }
      const checkout = await deps.prepareCheckout(bound.task.id, github)
      logger.info('repository checked out for the agent', { taskId: bound.task.id, repo: github.repo, baseSha: checkout.baseSha })
      return {
        taskId: bound.task.id,
        title: bound.task.title,
        description: bound.task.description ?? '',
        workDir: checkout.workDir,
        baseSha: checkout.baseSha,
      }
    })
  }
}

/**
 * `EXECUTE_FUNCTION` handler of `code_changes.open_pull_request`: the agent's changes become one
 * PR on the task, which moves to In review. `args.summary` is the agent's outcome summary,
 * `args.agentLabel` names the agent in the PR body.
 */
export function createOpenPullRequestFunction(deps: CodeChangeDeps = defaultDeps) {
  return async (args: Record<string, unknown>, context: ActivityContext): Promise<OpenedPullRequest> => {
    const bound = await bindRun(OPEN_PULL_REQUEST_FUNCTION, context, deps.resolveContainer)
    return closeOnFailure(bound, OPEN_PULL_REQUEST_FUNCTION, async () => {
      const change = await deps.collectChanges(bound.task.id)
      const github = await deps.resolveGitHub(bound.container, bound.scope, bound.projectId)
      const result = await deps.openPullRequest(bound.task, { ...change, summary: textArg(args.summary) }, github, textArg(args.agentLabel) || 'agent')
      await bound.run('task_delegation.task.link', `${OPEN_PULL_REQUEST_FUNCTION}:pr`, { kind: 'pr', ref: result.prLabel, url: result.prUrl })
      await bound.run('code_changes.change_request.record_pull_request', `${OPEN_PULL_REQUEST_FUNCTION}:change_request`, {
        number: result.prNumber,
        url: result.prUrl,
        branch: result.branch,
        headSha: result.headSha,
        summary: textArg(args.summary) || null,
      })
      await bound.run('task_delegation.task.set_status', `${OPEN_PULL_REQUEST_FUNCTION}:in_review`, { status: 'in_review' })
      await deps.removeCheckout(bound.task.id).catch((cleanupError: unknown) =>
        logger.warn('could not remove the checkout', { taskId: bound.task.id, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }))
      logger.info('pull request on the task', { taskId: bound.task.id, prUrl: result.prUrl })
      return result
    })
  }
}
