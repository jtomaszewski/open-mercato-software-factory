import { describe, expect, it } from '@jest/globals'
import { evaluateHumanTaskMutation, hasReachedMilestone, mapProcessStatus } from '../transitionPolicy'

describe('tasks transition policy', () => {
  it('maps workflow lifecycle statuses to staff columns', () => {
    expect(mapProcessStatus('open')).toBe('backlog')
    expect(mapProcessStatus('queued')).toBe('in-progress')
    expect(mapProcessStatus('in_design')).toBe('in-progress')
    expect(mapProcessStatus('in_review')).toBe('in-review')
    expect(mapProcessStatus('failed')).toBe('backlog')
    expect(mapProcessStatus('rejected')).toBe('backlog')
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
      from: 'in-review',
      to: 'backlog',
      activeDelegation: true,
      actorIsAssignee: true,
    })).toEqual({ allowed: true, releaseOutcome: 'rejected' })

    expect(evaluateHumanTaskMutation({
      operation: 'status_change',
      from: 'in-progress',
      to: 'in-review',
      activeDelegation: true,
      actorIsAssignee: true,
    })).toEqual({ allowed: false, code: 'process_owned' })
  })

  it('leaves undelegated tasks free to move and guards updates, deletes, children and undo', () => {
    expect(evaluateHumanTaskMutation({
      operation: 'status_change',
      from: 'backlog',
      to: 'in-progress',
      activeDelegation: false,
      actorIsAssignee: true,
    })).toEqual({ allowed: true })
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

describe('hasReachedMilestone', () => {
  it('reads arrays and the JSON-encoded strings the orchestrator stores', () => {
    expect(hasReachedMilestone([{ key: 'sized' }], 'sized')).toBe(true)
    expect(hasReachedMilestone('[{"key":"sized"}]', 'sized')).toBe(true)
    expect(hasReachedMilestone('[]', 'sized')).toBe(false)
    expect(hasReachedMilestone(null, 'sized')).toBe(false)
    expect(hasReachedMilestone('not json', 'sized')).toBe(false)
  })
})
