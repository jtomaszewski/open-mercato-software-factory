import type { ChangeRequestStatus } from '../data/entities'

export type ChangeRequestChip = { labelKey: string; variant: 'neutral' | 'success' | 'warning' | 'error' }

/**
 * One vocabulary for "where is this change", shared by the list, the detail header and anything
 * that shows a change request later, so the same status can never read two ways.
 *
 * It deliberately speaks about the change, not about git: "Waiting for you" is what an open change
 * request means to the person who has to decide it, and „open pull request” is not.
 */
export function changeRequestChip(status: ChangeRequestStatus): ChangeRequestChip {
  switch (status) {
    case 'generating': return { labelKey: 'code_changes.changeRequests.status.generating', variant: 'neutral' }
    case 'open': return { labelKey: 'code_changes.changeRequests.status.open', variant: 'warning' }
    case 'approved': return { labelKey: 'code_changes.changeRequests.status.approved', variant: 'success' }
    case 'rejected': return { labelKey: 'code_changes.changeRequests.status.rejected', variant: 'neutral' }
    default: return { labelKey: 'code_changes.changeRequests.status.failed', variant: 'error' }
  }
}

export const CHANGE_REQUEST_STATUSES: readonly ChangeRequestStatus[] = ['generating', 'open', 'approved', 'rejected', 'failed']
