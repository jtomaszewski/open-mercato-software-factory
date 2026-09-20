import { describe, expect, it } from '@jest/globals'
import type { AgentActivityRun } from '../lib/activity'
import { mergeActivityFeed, type LiveStep } from '../lib/activityFeed'

function run(overrides: Partial<AgentActivityRun> = {}): AgentActivityRun {
  return {
    id: 'run-mine',
    agentId: 'website_publishing.developer',
    status: 'running',
    startedAt: '2026-09-20T10:21:00.000Z',
    completedAt: null,
    errorMessage: null,
    steps: [],
    ...overrides,
  }
}

function liveStep(runId: string, sequence: number, tool: string): LiveStep {
  return {
    key: `${runId}-${sequence}`,
    runId,
    agentId: 'website_publishing.developer',
    sequence,
    kind: 'building',
    tool,
    detail: null,
    state: 'done',
    at: '2026-09-20T10:22:00.000Z',
  }
}

describe('mergeActivityFeed', () => {
  it('shows the live lines of a run that has not reported its trace yet, and says they are partial', () => {
    const feed = mergeActivityFeed([run()], [liveStep('run-mine', 1, 'bash'), liveStep('run-mine', 0, 'read')])
    expect(feed).toHaveLength(1)
    expect(feed[0].steps.map((step) => step.tool)).toEqual(['read', 'bash'])
    expect(feed[0].partial).toBe(true)
  })

  it('never shows a run this change request does not own', () => {
    // The progress broadcast is organization-scoped: a second task running at the same time
    // reaches this page too. Rendering it would tell the reader the agent did work on THEIR
    // change that it did on someone else's.
    const feed = mergeActivityFeed([run()], [liveStep('run-of-another-change', 0, 'bash')])
    expect(feed).toHaveLength(1)
    expect(feed[0].id).toBe('run-mine')
    expect(feed[0].steps).toEqual([])
  })

  it('prefers the persisted trace over the live preview of the same calls', () => {
    const persisted = run({
      status: 'ok',
      steps: [{ id: 'call-1', kind: 'building', tool: 'bash', detail: 'npm run build', status: 'ok', at: '2026-09-20T10:21:30.000Z', durationMs: 9000 }],
    })
    const feed = mergeActivityFeed([persisted], [liveStep('run-mine', 0, 'bash'), liveStep('run-mine', 1, 'read')])
    expect(feed[0].steps.map((step) => step.detail)).toEqual(['npm run build'])
    expect(feed[0].partial).toBe(false)
  })

  it('drops a finished run that left nothing to say', () => {
    expect(mergeActivityFeed([run({ status: 'ok' })], [])).toEqual([])
    expect(mergeActivityFeed([run({ status: 'error', errorMessage: 'timed out' })], [])).toHaveLength(1)
  })
})
