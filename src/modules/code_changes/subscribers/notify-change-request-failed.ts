import { notifyChangeRequest, type ChangeRequestEventPayload, type NotifiableContext } from '../lib/changeRequestNotifications'

/**
 * The run produced nothing. The task closes as failed and the change request keeps the reason,
 * but both are places someone has to go and look at; a failure nobody is told about is a task
 * that quietly stops moving.
 */
export const metadata = {
  event: 'code_changes.change_request.failed',
  persistent: true,
  id: 'code_changes:notify-change-request-failed',
}

export default async function handle(payload: ChangeRequestEventPayload, ctx: NotifiableContext): Promise<void> {
  await notifyChangeRequest('failed', payload, ctx)
}
