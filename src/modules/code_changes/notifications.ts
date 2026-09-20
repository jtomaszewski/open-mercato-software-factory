import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * What a person is told about a change request, and who is told.
 *
 * Two moments are worth interrupting someone for: a change that is finished and now waits on a
 * human decision, and a change that never produced one. Everything else — opened, approved,
 * rejected — is either invisible work or the consequence of a click the person just made, and a
 * bell that rings for those is a bell people stop reading.
 *
 * Neither type offers approve or reject as an action, although the notification framework would
 * run the command: merging into a production repository without having seen the diff, the checks
 * and the preview is exactly the affordance this module refuses elsewhere. The action opens the
 * change request; the decision stays where the evidence is.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'code_changes.change_request.ready',
    module: 'code_changes',
    // In-app only: e-mail delivery of every proposed change is a subscription nobody asked for,
    // and an operator can add the channel per type from Notification Delivery settings.
    channels: ['in_app'],
    titleKey: 'code_changes.notifications.ready.title',
    bodyKey: 'code_changes.notifications.ready.body',
    icon: 'git-pull-request-arrow',
    severity: 'info',
    actions: [
      {
        id: 'review',
        labelKey: 'code_changes.notifications.actions.review',
        variant: 'outline',
        icon: 'external-link',
        href: '/backend/code/changes/{sourceEntityId}',
      },
    ],
    primaryActionId: 'review',
    linkHref: '/backend/code/changes/{sourceEntityId}',
    // A pending decision that nobody took in a week is no longer news; the Code section still has it.
    expiresAfterHours: 168,
  },
  {
    type: 'code_changes.change_request.failed',
    module: 'code_changes',
    channels: ['in_app'],
    titleKey: 'code_changes.notifications.failed.title',
    bodyKey: 'code_changes.notifications.failed.body',
    icon: 'alert-triangle',
    severity: 'error',
    actions: [
      {
        id: 'review',
        labelKey: 'code_changes.notifications.actions.review',
        variant: 'outline',
        icon: 'external-link',
        href: '/backend/code/changes/{sourceEntityId}',
      },
    ],
    primaryActionId: 'review',
    linkHref: '/backend/code/changes/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
