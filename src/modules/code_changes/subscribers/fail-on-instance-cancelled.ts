import { failRunChangeRequest, type SubscriberContext, type WorkflowEndPayload } from '../lib/failOnRunEnd'

export const metadata = { event: 'workflows.instance.cancelled', persistent: true, id: 'code_changes:fail-on-instance-cancelled' }
export default function handler(payload: WorkflowEndPayload, context: SubscriberContext): Promise<void> {
  return failRunChangeRequest(payload, context)
}
