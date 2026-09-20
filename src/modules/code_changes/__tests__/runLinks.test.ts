import { describe, expect, it } from '@jest/globals'
import type { TaskDelegationLink } from '../../task_delegation/data/entities'
import { pullRequestLink } from '../lib/runLinks'

const link = (overrides: Partial<TaskDelegationLink>): TaskDelegationLink =>
  ({ kind: 'pr', ref: 'PR #12 · Publish the product page', url: 'https://github.com/o/r/pull/12', addedAt: '2026-09-19T10:00:00.000Z', ...overrides })

describe('pullRequestLink', () => {
  it('reads the number off the URL rather than the stored label', () => {
    expect(pullRequestLink([link({})])).toEqual({ url: 'https://github.com/o/r/pull/12', number: 12, label: '#12' })
  })

  it('falls back to the stored label when the URL carries no number', () => {
    expect(pullRequestLink([link({ url: 'https://github.com/o/r' })])).toMatchObject({ number: null, label: 'PR #12 · Publish the product page' })
  })

  it('answers the last pull request link, and ignores other artifacts', () => {
    const links = [link({ url: 'https://github.com/o/r/pull/1' }), { kind: 'caseload' as const, ref: 'c', url: null, addedAt: 'x' }, link({ url: 'https://github.com/o/r/pull/2' })]
    expect(pullRequestLink(links)?.number).toBe(2)
  })

  it('answers null when there is no pull request yet', () => {
    expect(pullRequestLink([])).toBeNull()
    expect(pullRequestLink(null)).toBeNull()
  })
})
