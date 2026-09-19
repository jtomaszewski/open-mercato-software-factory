import { describe, expect, it } from '@jest/globals'
import { AGENT_ROSTER, findRosterEntry, rosterAgentDefinitionIds, rosterProcessNames } from '../agentRoster'

describe('agent roster', () => {
  it('names one delegatable role in v1: the Software Engineer running the website change process', () => {
    expect(AGENT_ROSTER.map((entry) => [entry.agentDefinitionId, entry.processName])).toEqual([['developer', 'website_publishing.website_change']])
    // Legacy ids are listed too, so principals provisioned before the rename are still found.
    expect(rosterAgentDefinitionIds()).toEqual(['developer', 'factory'])
    expect(rosterProcessNames()).toEqual(['website_publishing.website_change'])
  })

  it('resolves a row by its agent definition id, or one of its legacy ids, and nothing else', () => {
    expect(findRosterEntry('developer')?.labelKey).toBe('task_delegation.agents.softwareEngineer')
    expect(findRosterEntry('factory')?.agentDefinitionId).toBe('developer')
    expect(findRosterEntry('researcher')).toBeNull()
    expect(findRosterEntry(null)).toBeNull()
    expect(findRosterEntry(undefined)).toBeNull()
  })

  it('gives every row both i18n keys, so a new role cannot be half-added', () => {
    for (const entry of AGENT_ROSTER) {
      expect(entry.labelKey).toMatch(/^task_delegation\.agents\./)
      expect(entry.descriptionKey).toMatch(/^task_delegation\.agents\./)
      expect(entry.labelFallback.length).toBeGreaterThan(0)
      expect(entry.descriptionFallback.length).toBeGreaterThan(0)
    }
  })
})
