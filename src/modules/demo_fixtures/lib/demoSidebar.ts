import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { runWithCacheTenant } from '@open-mercato/cache'
import { backendRouteMetadata } from '@/.mercato/generated/backend-route-metadata.generated'
import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { saveRoleSidebarPreference } from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'

/**
 * The pitch sidebar (SPEC-004): only the places Norbert works in. Everything else stays
 * installed and reachable by URL; it is only hidden from the menu, as a role default that
 * Customize sidebar can edit or clear.
 *
 * A role default cannot move an item to another group, so the task board (under the hidden
 * "My work"), deals and companies are hidden here and re-added where the pitch wants them by
 * `widgets/injection/demo-menu`.
 */
export const DEMO_SIDEBAR_VISIBLE_ITEMS = [
  '/backend/catalog/products',
  '/backend/sales/orders',
  // The Code section: where the owner sees what the Developer proposed and decides it. The board
  // drawer can approve one change, but only the change it belongs to — this is the list.
  '/backend/code/changes',
  '/backend/code/repositories',
]

// Groups shown whole, sub-items included: the factory's agents and the automations it runs on.
export const DEMO_SIDEBAR_VISIBLE_GROUPS = ['agent_orchestrator.nav.group', 'workflows.module.name']

export const DEMO_SIDEBAR_GROUP_ORDER = [
  'staff.time_tracking.nav.group',
  'catalog.nav.group',
  'customers~sales.nav.group',
  // The business areas, then the code the agents changed, then the agents themselves.
  'backend.nav.code',
  'agent_orchestrator.nav.group',
  'workflows.module.name',
]

// The board's group holds only the board; the pitch calls it Projects. Role defaults take a
// literal label, not a translation key, so this is Polish like the rest of the demo.
export const DEMO_SIDEBAR_GROUP_LABELS = { 'staff.time_tracking.nav.group': 'Projekty' }

type RouteLike = { path?: string; pattern?: string; groupKey?: string }

// Allow-list rather than a hand-kept deny-list: every static backend page except the visible
// ones, so a module enabled later is hidden too (after the next seed).
export function demoSidebarHiddenItems(routes: RouteLike[]): string[] {
  const hidden = new Set<string>()
  for (const route of routes) {
    const href = route.pattern ?? route.path ?? ''
    if (!href.startsWith('/backend/') || href.includes('[')) continue
    if (DEMO_SIDEBAR_VISIBLE_ITEMS.includes(href)) continue
    if (route.groupKey && DEMO_SIDEBAR_VISIBLE_GROUPS.includes(route.groupKey)) continue
    hidden.add(href)
  }
  return Array.from(hidden).sort()
}

export async function applyDemoSidebar(
  em: EntityManager,
  container: AppContainer,
  { tenantId }: { tenantId: string },
): Promise<{ roles: string[]; hiddenItems: number }> {
  const hiddenItems = demoSidebarHiddenItems(backendRouteMetadata)
  const roles = await findWithDecryption(em, Role, { tenantId, deletedAt: null }, undefined, { tenantId, organizationId: null })
  for (const role of roles) {
    await saveRoleSidebarPreference(em, { roleId: role.id, tenantId, locale: 'pl' }, {
      version: SIDEBAR_PREFERENCES_VERSION,
      groupOrder: DEMO_SIDEBAR_GROUP_ORDER,
      groupLabels: DEMO_SIDEBAR_GROUP_LABELS,
      hiddenItems,
    })
  }
  // The nav payload is cached per user; drop the tenant's entries so the next load sees the change.
  // The cache namespaces tags by tenant, so the delete has to run in the tenant's scope.
  const cache = container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<unknown> } | null
  await runWithCacheTenant(tenantId, async () => {
    await cache?.deleteByTags?.([`nav:sidebar:tenant:${tenantId}`])
  })
  return { roles: roles.map((role) => role.name), hiddenItems: hiddenItems.length }
}
