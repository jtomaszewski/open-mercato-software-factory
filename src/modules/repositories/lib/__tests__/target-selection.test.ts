import { describe, expect, it } from '@jest/globals'
import { chooseRepositoryTarget, repositoryProfileDigest } from '../target-selection'

const first = { id: 'first', isDefault: false, usable: true }
const second = { id: 'second', isDefault: false, usable: true }
describe('project repository selection', () => {
  it('resolves a sole link or explicit default and requires a choice otherwise', () => {
    expect(chooseRepositoryTarget([first])).toBe(first)
    expect(chooseRepositoryTarget([first, { ...second, isDefault: true }]).id).toBe('second')
    expect(() => chooseRepositoryTarget([first, second])).toThrow('repository_required')
    expect(chooseRepositoryTarget([first, second], 'first')).toBe(first)
  })
  it('refuses missing, unlinked, and unusable selections', () => {
    expect(() => chooseRepositoryTarget([])).toThrow('repository_required')
    expect(() => chooseRepositoryTarget([first], 'other')).toThrow('repository_not_linked')
    expect(() => chooseRepositoryTarget([{ ...first, usable: false }])).toThrow('repository_not_qualified')
    expect(chooseRepositoryTarget([{ ...first, usable: false }, second])).toBe(second)
  })
  it('freezes a canonical digest independent of nested JSON property order', () => {
    expect(repositoryProfileDigest({ version: 1, commands: { build: 'build', test: 'test' } }))
      .toBe(repositoryProfileDigest({ commands: { test: 'test', build: 'build' }, version: 1 }))
    expect(repositoryProfileDigest({ commands: { test: 'test' } })).not.toBe(repositoryProfileDigest({ commands: { test: 'changed' } }))
  })
})
