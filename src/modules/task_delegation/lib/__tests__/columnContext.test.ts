import { describe, expect, it, jest } from '@jest/globals'
import { authorizeInternalTaskTransition, consumeInternalTaskTransition } from '../columnContext'

// The key is the command's auth object: staff interceptors receive the same reference.
const context = { sub: 'user-id' }

describe('tasks per-request column context', () => {
  it('authorizes one exact internal move and consumes it', () => {
    authorizeInternalTaskTransition(context, 'task-id', 'in-progress')
    expect(consumeInternalTaskTransition(context, 'task-id', 'in-review')).toBe(false)
    expect(consumeInternalTaskTransition(context, 'task-id', 'in-progress')).toBe(true)
    expect(consumeInternalTaskTransition(context, 'task-id', 'in-progress')).toBe(false)
  })

  it('does not leak an authorization to another caller', () => {
    authorizeInternalTaskTransition(context, 'task-id', 'in-progress')
    expect(consumeInternalTaskTransition({ sub: 'user-id' }, 'task-id', 'in-progress')).toBe(false)
    expect(consumeInternalTaskTransition(null, 'task-id', 'in-progress')).toBe(false)
  })

  it('shares authorizations between separately bundled copies of the module', () => {
    // Generated bundles inline this file into both the commands and the interceptors output.
    let commandsCopy!: typeof import('../columnContext')
    let interceptorsCopy!: typeof import('../columnContext')
    jest.isolateModules(() => { commandsCopy = require('../columnContext') })
    jest.isolateModules(() => { interceptorsCopy = require('../columnContext') })
    expect(commandsCopy).not.toBe(interceptorsCopy)
    commandsCopy.authorizeInternalTaskTransition(context, 'bundled-task', 'in-progress')
    expect(interceptorsCopy.consumeInternalTaskTransition(context, 'bundled-task', 'in-progress')).toBe(true)
  })
})
