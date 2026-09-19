import { describe, expect, it } from '@jest/globals'
import { evaluateHumanTaskMutation, mapProcessStatus } from '../transitionPolicy'

describe('tasks transition policy', () => {
  it('maps workflow lifecycle statuses to staff columns', () => {
    expect(mapProcessStatus('open')).toBe('backlog')
    expect(mapProcessStatus('in_design')).toBe('in-design')
    expect(mapProcessStatus('failed')).toBe('closed')
  })

  it('keeps active delegated tasks process-owned except for assignee terminal review moves', () => {
    expect(evaluateHumanTaskMutation({
      operation: 'status_change',
      from: 'in-review',
      to: 'done',
      activeDelegation: true,
      actorIsAssignee: true,
    })).toEqual({ allowed: true, releaseOutcome: 'done' })

    expect(evaluateHumanTaskMutation({
      operation: 'status_change',
      from: 'in-progress',
      to: 'in-review',
      activeDelegation: true,
      actorIsAssignee: true,
    })).toEqual({ allowed: false, code: 'process_owned' })
  })

  it('reserves process-only columns and guards updates, deletes, children and undo', () => {
    expect(evaluateHumanTaskMutation({
      operation: 'status_change',
      from: 'backlog',
      to: 'queued',
      activeDelegation: false,
      actorIsAssignee: true,
    })).toEqual({ allowed: false, code: 'process_only_column' })
    expect(evaluateHumanTaskMutation({ operation: 'delete', activeDelegation: true })).toEqual({
      allowed: false,
      code: 'process_owned',
    })
    expect(evaluateHumanTaskMutation({ operation: 'undo', activeDelegation: true })).toEqual({
      allowed: false,
      code: 'process_owned',
    })
  })
})
