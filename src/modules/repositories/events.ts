import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'repositories.connection.connected', label: 'Repository connection connected', entity: 'connection', category: 'lifecycle' },
  { id: 'repositories.connection.status_changed', label: 'Repository connection status changed', entity: 'connection', category: 'lifecycle' },
  { id: 'repositories.repository.registered', label: 'Repository registered', entity: 'repository', category: 'lifecycle' },
  { id: 'repositories.repository.updated', label: 'Repository updated', entity: 'repository', category: 'crud' },
  { id: 'repositories.repository.qualified', label: 'Repository qualification completed', entity: 'repository', category: 'lifecycle' },
  { id: 'repositories.repository.status_changed', label: 'Repository status changed', entity: 'repository', category: 'lifecycle' },
  { id: 'repositories.project_link.changed', label: 'Repository project link changed', entity: 'project_link', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'repositories', events })
export const emitRepositoriesEvent = eventsConfig.emit
export default eventsConfig
