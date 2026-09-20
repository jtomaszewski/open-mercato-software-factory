import { notifyChangeRequest, type ChangeRequestEventPayload, type NotifiableContext } from '../lib/changeRequestNotifications'

/**
 * The agent finished and the change now waits on a person — the one moment in a run worth an
 * interruption. Before this, the only way to learn of it was to open the Code section and look.
 */
export const metadata = {
  event: 'code_changes.change_request.ready',
  persistent: true,
  id: 'code_changes:notify-change-request-ready',
}

export default async function handle(payload: ChangeRequestEventPayload, ctx: NotifiableContext): Promise<void> {
  await notifyChangeRequest('ready', payload, ctx)
}
