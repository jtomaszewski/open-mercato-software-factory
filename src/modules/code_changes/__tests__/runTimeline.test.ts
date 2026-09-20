import { describe, expect, it } from '@jest/globals'
import type { TaskRunDetail } from '../../task_delegation/lib/runsQuery'
import { buildRunTimeline, traceHref } from '../lib/runTimeline'

/** Keys pass through, so a test asserts on what the row says structurally, not on Polish copy. */
const t = (key: string, fallback?: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.values(params).join(',')})` : key

function run(overrides: Partial<TaskRunDetail> = {}): TaskRunDetail {
  return {
    taskId: 'task-1',
    taskTitle: 'Update the tank',
    taskDescription: null,
    projectId: 'project-1',
    projectName: 'www',
    delegation: {
      id: 'delegation-1',
      startedAt: '2026-09-20T10:21:00.000Z',
      releasedAt: null,
      closeReason: null,
      delegateUserId: 'user-1',
      delegateName: 'Software Engineer',
      links: [],
    } as unknown as TaskRunDetail['delegation'],
    process: null,
    steps: [],
    agentRuns: [],
    ...overrides,
  }
}

describe('buildRunTimeline', () => {
  it('puts every agent invocation on the timeline, in the order it happened', () => {
    const entries = buildRunTimeline(run({
      agentRuns: [
        { id: 'run-a', agentId: 'website_publishing.researcher', status: 'ok', stepId: 'research', startedAt: '2026-09-20T10:22:00.000Z', completedAt: '2026-09-20T10:22:30.000Z', latencyMs: 30000, errorMessage: null },
        { id: 'run-b', agentId: 'website_publishing.developer', status: 'running', stepId: 'develop', startedAt: '2026-09-20T10:23:00.000Z', completedAt: null, latencyMs: null, errorMessage: null },
      ],
    }), t, { canViewTrace: true })

    expect(entries.map((entry) => entry.label)).toEqual([
      'code_changes.runs.timeline.delegated',
      'code_changes.runs.agentRun.ok',
      'code_changes.runs.agentRun.running',
    ])
    expect(entries[1].href).toBe(traceHref('run-a'))
    expect(entries[2].href).toBe(traceHref('run-b'))
  })

  it('names the agent and how long it worked, and says nothing about a duration still running', () => {
    const [, finished, working] = buildRunTimeline(run({
      agentRuns: [
        { id: 'run-a', agentId: 'website_publishing.developer', status: 'ok', stepId: 'develop', startedAt: '2026-09-20T10:22:00.000Z', completedAt: '2026-09-20T10:24:05.000Z', latencyMs: null, errorMessage: null },
        { id: 'run-b', agentId: 'website_publishing.developer', status: 'running', stepId: 'develop', startedAt: '2026-09-20T10:25:00.000Z', completedAt: null, latencyMs: null, errorMessage: null },
      ],
    }), t, { canViewTrace: true })

    expect(finished.detail).toBe('website_publishing.developer · code_changes.runs.duration.minutes(2,5)')
    expect(working.detail).toBe('website_publishing.developer')
  })

  it('carries the reason a failed run stopped, so the row explains itself', () => {
    const [, failed] = buildRunTimeline(run({
      agentRuns: [
        { id: 'run-a', agentId: 'website_publishing.developer', status: 'error', stepId: 'develop', startedAt: '2026-09-20T10:22:00.000Z', completedAt: '2026-09-20T10:22:10.000Z', latencyMs: 10000, errorMessage: 'sandbox build failed' },
      ],
    }), t, { canViewTrace: true })

    expect(failed.label).toBe('code_changes.runs.agentRun.error')
    expect(failed.detail).toContain('sandbox build failed')
  })

  it('offers no trace link to a reader who may not open traces', () => {
    const [, agentRun] = buildRunTimeline(run({
      agentRuns: [
        { id: 'run-a', agentId: 'website_publishing.developer', status: 'ok', stepId: 'develop', startedAt: '2026-09-20T10:22:00.000Z', completedAt: null, latencyMs: 1000, errorMessage: null },
      ],
    }), t, { canViewTrace: false })

    expect(agentRun.label).toBe('code_changes.runs.agentRun.ok')
    expect(agentRun.href).toBeNull()
  })

  it('still tells the board story when the orchestrator reported no agent run at all', () => {
    const entries = buildRunTimeline(run({
      steps: [{ stepId: 'open_pull_request:pr', commandId: 'task_delegation.task.link', at: '2026-09-20T10:24:00.000Z', status: null }],
      delegation: { ...run().delegation, releasedAt: '2026-09-20T10:25:00.000Z', closeReason: 'delivered' },
    }), t, { canViewTrace: true })

    expect(entries.map((entry) => entry.label)).toEqual([
      'code_changes.runs.timeline.delegated',
      'code_changes.runs.step.task_delegation.task.link',
      'code_changes.runs.timeline.released',
    ])
    expect(entries.every((entry) => !entry.href)).toBe(true)
  })

  it('has nothing to show before a run exists', () => {
    expect(buildRunTimeline(null, t, { canViewTrace: true })).toEqual([])
  })
})
