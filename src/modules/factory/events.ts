import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'factory.order.fulfilled', label: 'Order fulfilled (website reference requested)', entity: 'order', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'factory', events })
export const emitFactoryEvent = eventsConfig.emit
export default eventsConfig
