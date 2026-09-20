import { describe, expect, it } from '@jest/globals'
import type { ChangeRequestStatus } from '../data/entities'
import { CHANGE_REQUEST_STATUSES, changeRequestChip } from '../lib/changeRequestPresentation'

describe('changeRequestChip', () => {
  it('speaks about the decision, not about git', () => {
    expect(changeRequestChip('open')).toEqual({ labelKey: 'code_changes.changeRequests.status.open', variant: 'warning' })
    expect(changeRequestChip('approved')).toEqual({ labelKey: 'code_changes.changeRequests.status.approved', variant: 'success' })
  })

  it('gives every status exactly one phrase, so two surfaces cannot disagree', () => {
    const keys = CHANGE_REQUEST_STATUSES.map((status) => changeRequestChip(status).labelKey)
    expect(new Set(keys).size).toBe(CHANGE_REQUEST_STATUSES.length)
  })

  it('never leaves an unknown status unlabelled', () => {
    expect(changeRequestChip('something-new' as ChangeRequestStatus).labelKey).toBe('code_changes.changeRequests.status.failed')
  })
})
