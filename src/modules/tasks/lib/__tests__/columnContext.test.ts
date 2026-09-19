import { describe, expect, it } from '@jest/globals'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { authorizeInternalTaskTransition, consumeInternalTaskTransition, rememberCreatedTaskColumn, createdTaskColumnSlug } from '../columnContext'

const context = {} as CommandRuntimeContext

describe('tasks transaction-local column context', () => {
  it('tracks a newly created column without exposing an input bypass flag', () => {
    rememberCreatedTaskColumn(context, 'status-id', 'queued')
    expect(createdTaskColumnSlug(context, 'status-id')).toBe('queued')
  })

  it('authorizes one exact internal move and consumes it', () => {
    authorizeInternalTaskTransition(context, 'task-id', 'queued')
    expect(consumeInternalTaskTransition(context, 'task-id', 'in-design')).toBe(false)
    expect(consumeInternalTaskTransition(context, 'task-id', 'queued')).toBe(true)
    expect(consumeInternalTaskTransition(context, 'task-id', 'queued')).toBe(false)
  })
})
