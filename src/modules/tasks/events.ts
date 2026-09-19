import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'tasks.task.delegated', label: 'Task delegated', entity: 'task', category: 'lifecycle' },
  { id: 'tasks.task.undelegated', label: 'Task undelegated', entity: 'task', category: 'lifecycle' },
  { id: 'tasks.task.linked', label: 'Task process linked', entity: 'task', category: 'lifecycle' },
  { id: 'tasks.task.changed', label: 'Task delegation changed', entity: 'task', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'tasks', events })
export const emitTasksEvent = eventsConfig.emit
export default eventsConfig
