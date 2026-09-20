import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * What happens to a change request, announced.
 *
 * Without these the only way to notice a change request move was to poll it, and our own task
 * drawer had to listen to `task_delegation.task.*` — another module's stream — to know that a
 * change it owns had changed. `code_changes.change_request.changed` is the one a surface
 * subscribes to; the specific four are what a subscriber or a workflow reacts to.
 */
const events = [
  { id: 'code_changes.change_request.opened', label: 'Change request opened', entity: 'change_request', category: 'lifecycle' },
  { id: 'code_changes.change_request.ready', label: 'Change request ready for a decision', entity: 'change_request', category: 'lifecycle' },
  { id: 'code_changes.change_request.approved', label: 'Change request approved', entity: 'change_request', category: 'lifecycle' },
  { id: 'code_changes.change_request.rejected', label: 'Change request rejected', entity: 'change_request', category: 'lifecycle' },
  { id: 'code_changes.change_request.failed', label: 'Change request failed', entity: 'change_request', category: 'lifecycle' },
  { id: 'code_changes.change_request.changed', label: 'Change request changed', entity: 'change_request', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'code_changes', events })
export const emitChangeRequestEvent = eventsConfig.emit
export default eventsConfig
