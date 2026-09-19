import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { backendRouteMetadata } from '@/.mercato/generated/backend-route-metadata.generated'
import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { saveRoleSidebarPreference } from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'

/**
 * The pitch sidebar (SPEC-004): only the places Marek works in. Everything else stays
 * installed and reachable by URL; it is only hidden from the menu, as a role default that
 * Customize sidebar can edit or clear.
 *
 * The task board is a child of "My work", which is hidden, so it comes back as a top-level
 * item injected by `widgets/injection/demo-tasks-menu`.
 */
export const DEMO_SIDEBAR_VISIBLE_ITEMS = ['/backend/catalog/products', '/backend/sales/orders', '/backend/caseload']

export const DEMO_SIDEBAR_GROUP_ORDER = [
  'staff.time_tracking.nav.group',
  'catalog.nav.group',
  'customers~sales.nav.group',
  'agent_orchestrator.nav.group',
]

type RouteLike = { path?: string; pattern?: string }

// Allow-list rather than a hand-kept deny-list: every static backend page except the visible
// ones, so a module enabled later is hidden too (after the next seed).
export function demoSidebarHiddenItems(routes: RouteLike[]): string[] {
  const hidden = new Set<string>()
  for (const route of routes) {
    const href = route.pattern ?? route.path ?? ''
    if (!href.startsWith('/backend/') || href.includes('[')) continue
    if (DEMO_SIDEBAR_VISIBLE_ITEMS.includes(href)) continue
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
      hiddenItems,
    })
  }
  // The nav payload is cached per user; drop the tenant's entries so the next load sees the change.
  const cache = container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<unknown> } | null
  await cache?.deleteByTags?.([`nav:sidebar:tenant:${tenantId}`])
  return { roles: roles.map((role) => role.name), hiddenItems: hiddenItems.length }
}
