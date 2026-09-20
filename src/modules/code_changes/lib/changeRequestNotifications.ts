import type { EntityManager } from '@mikro-orm/postgresql'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ChangeRequest } from '../data/entities'
import { notificationTypes } from '../notifications'

const logger = createLogger('code_changes').child({ area: 'notifications' })

/**
 * How a change request is addressed in the bell. Frozen once shipped: `deleteBySource` finds a
 * notification by this pair, so changing it would orphan every notification already out there.
 */
export const CHANGE_REQUEST_SOURCE = 'code_changes:change_request'

/** The payload `announce` puts on every `code_changes.change_request.*` event. */
export type ChangeRequestEventPayload = {
  changeRequestId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

export type NotifiableContext = { resolve: <T = unknown>(name: string) => T }

type Target = { changeRequestId: string; tenantId: string; organizationId: string }

/** The reason is stored whole (up to 8k); a bell body is one glance, not a log. */
const REASON_LIMIT = 200

function targetOf(payload: ChangeRequestEventPayload): Target | null {
  const changeRequestId = typeof payload?.changeRequestId === 'string' ? payload.changeRequestId : ''
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : ''
  const organizationId = typeof payload?.organizationId === 'string' ? payload.organizationId : ''
  if (!changeRequestId || !tenantId || !organizationId) return null
  return { changeRequestId, tenantId, organizationId }
}

/**
 * Who is interrupted, and by which of the two types.
 *
 * `ready` goes to the people who may decide, because the notification asks for a decision and
 * anyone else can only look. `failed` goes to the people who may delegate: a run that produced
 * nothing is not a decision, it is work to hand out again, and the decider may well be someone
 * who never asked for it.
 */
const KINDS = {
  ready: { type: 'code_changes.change_request.ready', status: 'open', feature: 'code_changes.decide' },
  failed: { type: 'code_changes.change_request.failed', status: 'failed', feature: 'task_delegation.delegate' },
} as const

export type ChangeRequestNotificationKind = keyof typeof KINDS

/**
 * Turns a change-request transition into the one notification it deserves.
 *
 * The record is re-read rather than trusted from the payload: the event carries ids and a status,
 * not the title or the failure reason a person actually reads, and a delivery that arrives after
 * the change was decided must not raise a decision that no longer exists — hence the status guard.
 *
 * `groupKey` is the change request, so a replayed workflow step or a re-delivered event refreshes
 * the single notification per recipient instead of stacking a column of identical ones.
 */
export async function notifyChangeRequest(
  kind: ChangeRequestNotificationKind,
  payload: ChangeRequestEventPayload,
  ctx: NotifiableContext,
): Promise<void> {
  const target = targetOf(payload)
  if (!target) return
  const { type, status, feature } = KINDS[kind]
  try {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const entity = await em.findOne(ChangeRequest, {
      id: target.changeRequestId,
      tenantId: target.tenantId,
      organizationId: target.organizationId,
      deletedAt: null,
    })
    if (!entity || entity.status !== status) return

    const typeDef = notificationTypes.find((candidate) => candidate.type === type)
    if (!typeDef) return

    const input = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: feature,
      bodyVariables: {
        title: entity.title,
        // A dash rather than an empty string: the body reads "… did not finish: {reason}", and a
        // sentence that stops after the colon looks like the message itself was truncated.
        reason: (entity.statusReason ?? '').trim().slice(0, REASON_LIMIT) || '—',
      },
      sourceEntityType: CHANGE_REQUEST_SOURCE,
      sourceEntityId: entity.id,
      linkHref: `/backend/code/changes/${entity.id}`,
      groupKey: entity.id,
    })

    await resolveNotificationService(ctx).createForFeature(
      // The change request belongs to one organization; a decider in another one holds the same
      // right over entirely different repositories and must not be told about this change.
      { ...input, restrictRecipientsToOrganization: true },
      { tenantId: target.tenantId, organizationId: target.organizationId },
    )
  } catch (err) {
    // Swallowed on purpose: a throwing subscriber fails the whole queued event and re-runs every
    // other subscriber of it on retry. A bell that did not ring is recoverable — the Code section
    // is the record — and re-running a transition's other effects is not.
    logger.error('change request notification skipped', { err, changeRequestId: target.changeRequestId, kind })
  }
}

/**
 * Clears the pending notification once the change request has been decided.
 *
 * Without this, everyone who was asked for a decision keeps an unread "waiting for you" for a
 * change somebody already merged — the bell's version of a stale badge. The decision itself is
 * not announced: whoever made it just made it, and nobody else has anything left to do.
 */
export async function clearChangeRequestNotifications(
  payload: ChangeRequestEventPayload,
  ctx: NotifiableContext,
): Promise<void> {
  const target = targetOf(payload)
  if (!target) return
  try {
    await resolveNotificationService(ctx).deleteBySource(CHANGE_REQUEST_SOURCE, target.changeRequestId, {
      tenantId: target.tenantId,
      organizationId: target.organizationId,
    })
  } catch (err) {
    logger.error('change request notification cleanup skipped', { err, changeRequestId: target.changeRequestId })
  }
}
