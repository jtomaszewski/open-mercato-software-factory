import { beforeEach, expect, it, jest } from '@jest/globals'
import { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'

const findOne = jest.fn<(em: unknown, entity: unknown, where: Record<string, unknown>) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (em: unknown, entity: unknown, where: Record<string, unknown>) => findOne(em, entity, where) }))
const resolveExecutionUser = jest.fn<(...args: unknown[]) => Promise<string | null>>()
jest.mock('@open-mercato/core/modules/workflows/lib/definition-grant', () => ({ resolveWorkflowDefinitionExecutionUserId: (...args: unknown[]) => resolveExecutionUser(...args) }))

// The real request container pulls in the ESM-only DB driver; the deps inject one instead.
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))

import {
  createOpenPullRequestFunction,
  createPrepareCheckoutFunction,
  OPEN_PULL_REQUEST_FUNCTION,
  PREPARE_CHECKOUT_FUNCTION,
  type CodeChangeDeps,
} from '../lib/functions'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const description = 'Produkt: /backend/catalog/products/aaaaaaaa-0000-4000-8000-000000000003'
const execute = jest.fn<(id: string, args: { input: Record<string, unknown>; ctx: { auth: { sub: string } } }) => Promise<unknown>>()

const container = {
  resolve: (name: string) => ({
    em: { fork: () => ({}) },
    commandBus: { execute },
    queryEngine: { query: async () => ({ items: [{ id: 'task-1', title: 'Opublikuj stronę produktu ZWM-1500', description, time_project_id: 'project-1' }] }) },
  } as Record<string, unknown>)[name],
}
const deps = {
  resolveContainer: async () => container as never,
  resolveGitHub: jest.fn<CodeChangeDeps['resolveGitHub']>(),
  prepareCheckout: jest.fn<CodeChangeDeps['prepareCheckout']>(),
  collectChanges: jest.fn<CodeChangeDeps['collectChanges']>(),
  removeCheckout: jest.fn<CodeChangeDeps['removeCheckout']>(),
  openPullRequest: jest.fn<CodeChangeDeps['openPullRequest']>(),
}
const prepare = createPrepareCheckoutFunction(deps)
const openPr = createOpenPullRequestFunction(deps)
const context = { workflowInstance: { id: 'wf-1', definitionId: 'def-1', ...scope }, workflowContext: {} } as never
const identity = { taskId: 'task-1', delegationId: 'delegation-1', processInstanceId: 'process-1' }
const site = { token: 'app-token', repo: 'o/site', baseBranch: 'main', apiUrl: 'https://api.github.com', repositoryId: 'repo-1' }
const calls = () => execute.mock.calls.map(([id, args]) => [id, args.input])

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ result: { id: 'change-1' } })
  resolveExecutionUser.mockReset().mockResolvedValue('principal-1')
  deps.resolveGitHub.mockReset().mockResolvedValue(site)
  deps.prepareCheckout.mockReset().mockResolvedValue({ baseSha: 'base-sha', workDir: '/home/opencode/work/tasks/task-1' })
  deps.collectChanges.mockReset().mockResolvedValue({ baseSha: 'base-sha', files: [{ path: 'app/a.tsx', content: 'x' }] })
  deps.removeCheckout.mockReset().mockResolvedValue(undefined)
  deps.openPullRequest.mockReset().mockResolvedValue({ prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', prLabel: 'PR #7 · ZWM-1500', branch: 'developer/task-task-1', headSha: 'head-sha' })
  findOne.mockReset().mockImplementation(async (_em, entity, where) => {
    if (entity === ProcessInstance) return where.workflowInstanceId === 'wf-1' ? { id: 'process-1', input: { taskId: 'task-1', delegationId: 'delegation-1' } } : null
    if (entity === WorkflowDefinition) return { id: 'def-1' }
    return null
  })
})

it('prepare: moves the bound task to In progress and checks out its project repository', async () => {
  const input = await prepare({}, context)
  expect(calls()).toEqual([
    ['task_delegation.task.set_status', { ...identity, stepId: `${PREPARE_CHECKOUT_FUNCTION}:in_progress`, status: 'in_progress' }],
    ['code_changes.change_request.start', {
      ...identity, stepId: `${PREPARE_CHECKOUT_FUNCTION}:change_request`,
      projectId: 'project-1', title: 'Opublikuj stronę produktu ZWM-1500', repoFullName: 'o/site', baseBranch: 'main', repositoryId: 'repo-1',
    }],
    // The drawer's one offer while the agent works: open the change and watch it happen.
    ['task_delegation.task.link', {
      ...identity, stepId: `${PREPARE_CHECKOUT_FUNCTION}:change_link`,
      kind: 'change', ref: 'Opublikuj stronę produktu ZWM-1500', url: '/backend/code/changes/change-1',
    }],
  ])
  expect(execute.mock.calls[0]![1].ctx.auth.sub).toBe('principal-1')
  expect(deps.resolveGitHub).toHaveBeenCalledWith(expect.anything(), scope, 'project-1')
  expect(deps.prepareCheckout).toHaveBeenCalledWith('task-1', site)
  expect(input).toEqual({
    taskId: 'task-1', title: 'Opublikuj stronę produktu ZWM-1500', description,
    workDir: '/home/opencode/work/tasks/task-1', baseSha: 'base-sha',
  })
})

it('prepare: a clone failure closes the task with the reason', async () => {
  deps.prepareCheckout.mockRejectedValue(new Error('Cannot clone o/site: network'))
  await expect(prepare({}, context)).rejects.toThrow('Cannot clone')
  expect(calls().map(([id]) => id)).toEqual([
    'task_delegation.task.set_status',
    'code_changes.change_request.start',
    'task_delegation.task.link',
    'task_delegation.task.set_status',
    'code_changes.change_request.mark_failed',
  ])
  expect((execute.mock.calls[3]![1].input as { reason: string }).reason).toContain('Cannot clone')
  expect((execute.mock.calls[4]![1].input as { reason: string }).reason).toContain('Cannot clone')
})

it('open PR: commits the collected change with the agent summary, links the PR, moves the task to review and removes the checkout', async () => {
  const result = await openPr({ summary: 'Dodałem stronę.', agentLabel: 'agent Developer' }, context)
  expect(deps.collectChanges).toHaveBeenCalledWith('task-1')
  expect(deps.openPullRequest).toHaveBeenCalledWith(
    { id: 'task-1', title: 'Opublikuj stronę produktu ZWM-1500', description },
    { baseSha: 'base-sha', files: [{ path: 'app/a.tsx', content: 'x' }], summary: 'Dodałem stronę.' },
    site,
    'agent Developer',
  )
  expect(calls()).toEqual([
    ['task_delegation.task.link', { ...identity, stepId: `${OPEN_PULL_REQUEST_FUNCTION}:pr`, kind: 'pr', ref: 'PR #7 · ZWM-1500', url: 'https://github.com/o/r/pull/7' }],
    ['code_changes.change_request.record_pull_request', {
      ...identity, stepId: `${OPEN_PULL_REQUEST_FUNCTION}:change_request`,
      number: 7, url: 'https://github.com/o/r/pull/7', branch: 'developer/task-task-1', headSha: 'head-sha', summary: 'Dodałem stronę.',
    }],
    ['task_delegation.task.set_status', { ...identity, stepId: `${OPEN_PULL_REQUEST_FUNCTION}:in_review`, status: 'in_review' }],
  ])
  expect(deps.removeCheckout).toHaveBeenCalledWith('task-1')
  expect(result.prUrl).toBe('https://github.com/o/r/pull/7')
})

it('open PR: unresolved argument tokens are treated as absent', async () => {
  await openPr({ summary: '{{context.developer.summary}}', agentLabel: '{{context.agent}}' }, context)
  expect(deps.openPullRequest.mock.calls[0]![1].summary).toBe('')
  expect(deps.openPullRequest.mock.calls[0]![3]).toBe('agent')
})

it('open PR: an empty change closes the task as failed and keeps the checkout for inspection', async () => {
  deps.collectChanges.mockRejectedValue(new Error('The agent finished without changing any file.'))
  await expect(openPr({}, context)).rejects.toThrow('without changing any file')
  expect(deps.openPullRequest).not.toHaveBeenCalled()
  expect(deps.removeCheckout).not.toHaveBeenCalled()
  expect(calls()).toEqual([
    ['task_delegation.task.set_status', { ...identity, stepId: `${OPEN_PULL_REQUEST_FUNCTION}:failed`, status: 'failed', reason: 'The agent finished without changing any file.' }],
    ['code_changes.change_request.mark_failed', { ...identity, stepId: `${OPEN_PULL_REQUEST_FUNCTION}:change_request_failed`, reason: 'The agent finished without changing any file.' }],
  ])
})

it('refuses a workflow instance with no bound delegation', async () => {
  findOne.mockResolvedValue(null)
  await expect(prepare({}, context)).rejects.toThrow('no delegated task is bound')
  await expect(openPr({}, context)).rejects.toThrow('no delegated task is bound')
  expect(execute).not.toHaveBeenCalled()
})

it('refuses to act without an execution principal', async () => {
  resolveExecutionUser.mockResolvedValue(null)
  await expect(prepare({}, context)).rejects.toThrow('no execution principal')
  expect(execute).not.toHaveBeenCalled()
})
