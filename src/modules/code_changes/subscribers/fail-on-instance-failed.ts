import { failRunChangeRequest, type SubscriberContext, type WorkflowEndPayload } from '../lib/failOnRunEnd'

export const metadata = { event: 'workflows.instance.failed', persistent: true, id: 'code_changes:fail-on-instance-failed' }
export default function handler(payload: WorkflowEndPayload, context: SubscriberContext): Promise<void> {
  return failRunChangeRequest(payload, context)
}
