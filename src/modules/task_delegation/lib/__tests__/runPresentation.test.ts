import { describe, expect, it } from '@jest/globals'
import type { TaskDelegationDto } from '../delegationService'
import {
  availableRunBarActions,
  isConfigurationFailure,
  resolveRunBarState,
  resolveRunChip,
  runBarActions,
  runElapsedMinutes,
} from '../runPresentation'

const NOW = Date.parse('2026-09-19T12:00:00.000Z')

function delegation(overrides: Partial<TaskDelegationDto> = {}): TaskDelegationDto {
  return {
    id: 'delegation',
    delegateUserId: 'agent-user',
    delegateName: 'Software Engineer',
    releasedAt: null,
    updatedAt: '2026-09-19T11:48:00.000Z',
    startedAt: '2026-09-19T11:48:00.000Z',
    processInstanceId: 'process',
    links: [],
    outcome: null,
    closeReason: null,
    runState: 'running',
    ...overrides,
  }
}

describe('resolveRunBarState', () => {
  it('reads no run at all when there is no delegation', () => {
    expect(resolveRunBarState(null)).toBe('none')
  })

  it('reads an agent a person removed as no run, not as a finished one', () => {
    expect(resolveRunBarState(delegation({ releasedAt: '2026-09-19T11:59:00.000Z', outcome: null }))).toBe('none')
  })

  it('splits the read model’s complete into ready-to-approve and published', () => {
    expect(resolveRunBarState(delegation({ runState: 'complete' }))).toBe('complete')
    expect(resolveRunBarState(delegation({
      runState: 'complete', outcome: 'done', releasedAt: '2026-09-19T11:59:00.000Z',
    }))).toBe('published')
  })

  it('splits a failure into the setup’s and the agent’s', () => {
    expect(resolveRunBarState(delegation({
      runState: 'failed', outcome: 'failed', processInstanceId: null, closeReason: null,
    }))).toBe('failedConfig')
    expect(resolveRunBarState(delegation({
      runState: 'failed', outcome: 'failed', closeReason: 'CODE_CHANGES_GITHUB_TOKEN is not set and the project has no linked repository; cannot open pull requests.',
    }))).toBe('failedConfig')
    expect(resolveRunBarState(delegation({
      runState: 'failed', outcome: 'failed', closeReason: 'Nie znalazłem pliku hero-2026.jpg w katalogu zdjęć.',
    }))).toBe('failedAgent')
  })

  it('does not invent progress when the orchestrator could not be read', () => {
    expect(resolveRunBarState(delegation({ runState: null }))).toBe('stalled')
  })

  it('keeps every other state as the read model reports it', () => {
    expect(resolveRunBarState(delegation({ runState: 'starting' }))).toBe('starting')
    expect(resolveRunBarState(delegation({ runState: 'stalled' }))).toBe('stalled')
    expect(resolveRunBarState(delegation({ runState: 'awaiting_decision' }))).toBe('awaiting_decision')
    expect(resolveRunBarState(delegation({ runState: 'rejected', outcome: 'rejected' }))).toBe('rejected')
  })
})

describe('isConfigurationFailure', () => {
  it('treats a run that never reached a process instance as a setup problem', () => {
    expect(isConfigurationFailure(delegation({ processInstanceId: null }))).toBe(true)
  })

  it('does not blame configuration for a reason the agent wrote', () => {
    expect(isConfigurationFailure(delegation({ closeReason: 'Zmiana dotknęłaby chronionych plików.' }))).toBe(false)
  })
})

describe('runBarActions', () => {
  it('offers one way forward per state and never a retry on a setup failure', () => {
    expect(runBarActions('none')).toEqual(['delegate'])
    expect(runBarActions('running')).toEqual(['takeOver'])
    expect(runBarActions('running', true)).toEqual(['changeDetail'])
    expect(runBarActions('stalled', true)).toEqual(['changeDetail', 'takeOver'])
    expect(runBarActions('awaiting_decision')).toEqual(['caseload'])
    expect(runBarActions('failedConfig')).toEqual(['takeOver'])
    expect(runBarActions('failedAgent')).toEqual(['retry', 'takeOver'])
    expect(runBarActions('rejected')).toEqual(['retry', 'takeOver'])
  })

  it('leaves approving and previewing to the code_changes panel', () => {
    expect(runBarActions('complete')).toEqual([])
    expect(runBarActions('published')).toEqual([])
  })
})

describe('runElapsedMinutes', () => {
  it('counts from the delegation, rounded so it never reads zero', () => {
    expect(runElapsedMinutes(delegation(), NOW)).toBe(12)
    expect(runElapsedMinutes(delegation({ startedAt: '2026-09-19T11:59:50.000Z' }), NOW)).toBe(1)
  })
})

describe('resolveRunChip', () => {
  it('says the running state in one phrase with its minutes', () => {
    expect(resolveRunChip(delegation(), NOW)).toEqual({
      labelKey: 'task_delegation.runState.runningWithMinutes', params: { minutes: 12 }, variant: 'neutral',
    })
  })

  it('distinguishes ready-to-approve from published', () => {
    expect(resolveRunChip(delegation({ runState: 'complete' }), NOW)?.labelKey).toBe('task_delegation.runState.complete')
    expect(resolveRunChip(delegation({ runState: 'complete', outcome: 'done', releasedAt: '2026-09-19T11:59:00.000Z' }), NOW)?.labelKey)
      .toBe('task_delegation.runState.published')
  })

  it('shows one failure phrase whichever half of the run failed', () => {
    expect(resolveRunChip(delegation({ runState: 'failed', outcome: 'failed', processInstanceId: null }), NOW))
      .toEqual({ labelKey: 'task_delegation.runState.failed', variant: 'error' })
    expect(resolveRunChip(delegation({ runState: 'failed', outcome: 'failed', closeReason: 'agent gave up' }), NOW))
      .toEqual({ labelKey: 'task_delegation.runState.failed', variant: 'error' })
  })

  it('carries no chip for a task nobody delegated', () => {
    expect(resolveRunChip(null, NOW)).toBeNull()
  })
})

describe('availableRunBarActions', () => {
  it('offers nothing but reading the Caseload without the delegate permission', () => {
    expect(availableRunBarActions({ state: 'none', hasActiveDelegation: false, canDelegate: false })).toEqual([])
    expect(availableRunBarActions({ state: 'running', hasActiveDelegation: true, canDelegate: false })).toEqual([])
    expect(availableRunBarActions({ state: 'awaiting_decision', hasActiveDelegation: true, canDelegate: false }))
      .toEqual(['caseload'])
  })

  it('lets anyone who can see the task open its change, permission or not', () => {
    expect(availableRunBarActions({ state: 'running', hasActiveDelegation: true, canDelegate: false, hasChangeLink: true }))
      .toEqual(['changeDetail'])
    expect(availableRunBarActions({ state: 'running', hasActiveDelegation: true, canDelegate: true, hasChangeLink: true }))
      .toEqual(['changeDetail'])
  })

  it('does not offer taking over a run that already released the task', () => {
    expect(availableRunBarActions({ state: 'failedAgent', hasActiveDelegation: false, canDelegate: true }))
      .toEqual(['retry'])
    expect(availableRunBarActions({ state: 'failedConfig', hasActiveDelegation: false, canDelegate: true }))
      .toEqual([])
    expect(availableRunBarActions({ state: 'running', hasActiveDelegation: true, canDelegate: true }))
      .toEqual(['takeOver'])
  })
})
