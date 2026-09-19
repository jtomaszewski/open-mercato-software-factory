import { failDelegatedTask, type SubscriberContext, type WorkflowEndPayload } from '../lib/failOnInstanceEnd'

export const metadata = { event: 'workflows.instance.cancelled', persistent: true, id: 'tasks:fail-on-instance-cancelled' }
export default function handler(payload: WorkflowEndPayload, context: SubscriberContext): Promise<void> {
  return failDelegatedTask(payload, context)
}
