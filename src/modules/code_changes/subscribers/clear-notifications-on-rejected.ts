import { clearChangeRequestNotifications, type ChangeRequestEventPayload, type NotifiableContext } from '../lib/changeRequestNotifications'

/** Rejected: as with approval, the decision is made and the pending notification is stale. */
export const metadata = {
  event: 'code_changes.change_request.rejected',
  persistent: true,
  id: 'code_changes:clear-notifications-on-rejected',
}

export default async function handle(payload: ChangeRequestEventPayload, ctx: NotifiableContext): Promise<void> {
  await clearChangeRequestNotifications(payload, ctx)
}
