/**
 * Who the delegatable agent is. Separate from `demoSetup` because provisioning it is a demo
 * concern, but reading and renaming it is not: `renameAgent` runs against production databases.
 */

/**
 * The agent definition id. The roster's process binding, the delegation-start subscriber, the
 * generated agent email and the seeded rows all key on it (code repositories spec, REQ-006).
 */
export const DEVELOPER_AGENT_ID = 'developer'

/**
 * Ids of principals provisioned before REQ-006 renamed the agent. Still accepted everywhere the
 * new id is, so a database seeded earlier keeps delegating; nothing provisions them any more.
 * Drop them (and the `$in`/loop lookups that read this list) one release after the rename.
 */
export const LEGACY_DEVELOPER_AGENT_IDS = ['factory'] as const

/** The new id first: a lookup that finds several principals prefers the current one. */
export const DEVELOPER_AGENT_IDS: readonly string[] = [DEVELOPER_AGENT_ID, ...LEGACY_DEVELOPER_AGENT_IDS]

export function isDeveloperAgentId(agentDefinitionId: string | null | undefined): boolean {
  return typeof agentDefinitionId === 'string' && DEVELOPER_AGENT_IDS.includes(agentDefinitionId)
}

/**
 * The agent's job title, stored as its principal's `auth.User.name` and read straight from there
 * by the picker, the card badge, the drawer, audit entries and the MCP tools (SPEC-008). This is
 * the name people read; the id above is what the machine matches on. (D-047 proposes "Developer"
 * here too, but that is a user-visible change of its own, not part of the id rename.)
 */
export const DEVELOPER_AGENT_DISPLAY_NAME = 'Software Engineer'
