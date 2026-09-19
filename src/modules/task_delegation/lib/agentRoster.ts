/**
 * The roles a person may delegate a task to, and the process each one starts.
 *
 * A delegatable role is a role with a process behind it, so the pair lives in one place: the
 * provisioned principal's `agentDefinitionId` and the `ProcessDefinition` name its delegation
 * starts. Adding a role is this row plus its two i18n keys — not a database change, and not
 * something an operator can half-create.
 *
 * `label` is what our own surfaces render; every surface we do not own (audit, `staff`,
 * notifications, MCP) keeps reading the principal's `auth.User.name`.
 */
import { DEVELOPER_AGENT_ID, LEGACY_DEVELOPER_AGENT_IDS } from './agentIdentity'

export type AgentRosterEntry = {
  agentDefinitionId: string
  /** Ids the same role was provisioned under before a rename; matched, never provisioned. */
  legacyAgentDefinitionIds?: readonly string[]
  labelKey: string
  labelFallback: string
  descriptionKey: string
  descriptionFallback: string
  processName: string
}

export const AGENT_ROSTER: readonly AgentRosterEntry[] = [
  {
    agentDefinitionId: DEVELOPER_AGENT_ID,
    legacyAgentDefinitionIds: LEGACY_DEVELOPER_AGENT_IDS,
    labelKey: 'task_delegation.agents.softwareEngineer',
    labelFallback: 'Software Engineer',
    descriptionKey: 'task_delegation.agents.softwareEngineer.description',
    descriptionFallback: 'Researches, plans and opens a PR',
    processName: 'website_publishing.website_change',
  },
]

export function findRosterEntry(agentDefinitionId: string | null | undefined): AgentRosterEntry | null {
  if (!agentDefinitionId) return null
  return AGENT_ROSTER.find((entry) =>
    entry.agentDefinitionId === agentDefinitionId || (entry.legacyAgentDefinitionIds ?? []).includes(agentDefinitionId)) ?? null
}

/** Every id a rostered principal may carry, legacy ones included: for `$in` lookups. */
export function rosterAgentDefinitionIds(): string[] {
  return AGENT_ROSTER.flatMap((entry) => [entry.agentDefinitionId, ...(entry.legacyAgentDefinitionIds ?? [])])
}

export function rosterProcessNames(): string[] {
  return [...new Set(AGENT_ROSTER.map((entry) => entry.processName))]
}
