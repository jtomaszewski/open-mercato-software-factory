import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'website_publishing.order.fulfilled', label: 'Order fulfilled (website reference requested)', entity: 'order', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'website_publishing', events })
export const emitWebsitePublishingEvent = eventsConfig.emit
export default eventsConfig
