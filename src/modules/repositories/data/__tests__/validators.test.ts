import { describe, expect, it } from '@jest/globals'
import { connectionCompleteSchema, connectionStartSchema, repositoryRegisterSchema } from '../validators'

describe('repository connection schemas', () => {
  it('accepts both a new installation start and a bounded existing installation ID', () => {
    expect(connectionStartSchema.parse({})).toEqual({})
    expect(connectionStartSchema.parse({ installationId: '123456' })).toEqual({ installationId: '123456' })
    expect(connectionStartSchema.safeParse({ installationId: 'not-numeric' }).success).toBe(false)
    expect(connectionStartSchema.safeParse({ installationId: '1', extra: true }).success).toBe(false)
  })

  it('accepts the code-and-state-only OAuth return for an existing installation', () => {
    const existingReturn = { code: 'oauth-code', state: 'x'.repeat(43) }
    expect(connectionCompleteSchema.parse(existingReturn)).toEqual(existingReturn)
  })
})

describe('repository register schema', () => {
  it('needs a connection, a GitHub repository id and a base branch, nothing else', () => {
    const valid = { connectionId: '00000000-0000-4000-8000-000000000001', githubRepositoryId: '42', baseBranch: 'main' }
    expect(repositoryRegisterSchema.parse(valid)).toEqual(valid)
    expect(repositoryRegisterSchema.safeParse({ ...valid, baseBranch: ' ' }).success).toBe(false)
    expect(repositoryRegisterSchema.safeParse({ ...valid, token: 'secret' }).success).toBe(false)
  })
})
