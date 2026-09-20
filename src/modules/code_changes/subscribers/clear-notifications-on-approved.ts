import { clearChangeRequestNotifications, type ChangeRequestEventPayload, type NotifiableContext } from '../lib/changeRequestNotifications'

/**
 * Approved: the request for a decision is answered, so it leaves everyone's bell. A subscriber
 * per event because a subscriber declares exactly one — and `code_changes.change_request.*` would
 * also match the `.changed` broadcast every transition emits.
 */
export const metadata = {
  event: 'code_changes.change_request.approved',
  persistent: true,
  id: 'code_changes:clear-notifications-on-approved',
}

export default async function handle(payload: ChangeRequestEventPayload, ctx: NotifiableContext): Promise<void> {
  await clearChangeRequestNotifications(payload, ctx)
}
