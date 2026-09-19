import { describe, expect, it } from '@jest/globals'
import { connectionCompleteSchema, connectionStartSchema, prOnlyProfileSchema, staticSiteProfileSchema } from '../validators'

const commands = { install: 'corepack yarn install', build: 'corepack yarn build', test: 'corepack yarn test' }

describe('repository profile schemas', () => {
  it('accepts an explicit strict PR-only profile', () => {
    expect(prOnlyProfileSchema.parse({ version: 1, commands })).toEqual({ version: 1, commands })
  })

  it('rejects missing commands, secret-shaped additions, and host defaults', () => {
    expect(prOnlyProfileSchema.safeParse({ version: 1, commands: { build: 'yarn build', test: 'yarn test' } }).success).toBe(false)
    expect(prOnlyProfileSchema.safeParse({ version: 1, commands, token: 'secret' }).success).toBe(false)
    expect(prOnlyProfileSchema.safeParse({ version: 1, commands: { ...commands, install: '' } }).success).toBe(false)
  })

  it('requires bounded static-site identifiers and a safe relative output directory', () => {
    const valid = { version: 1, commands, outputDirectory: 'dist/site', vercel: { accountId: 'team_1', projectId: 'project_1' } }
    expect(staticSiteProfileSchema.safeParse(valid).success).toBe(true)
    expect(staticSiteProfileSchema.safeParse({ ...valid, outputDirectory: '../dist' }).success).toBe(false)
    expect(staticSiteProfileSchema.safeParse({ ...valid, vercel: { ...valid.vercel, accessToken: 'secret' } }).success).toBe(false)
  })
})

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
