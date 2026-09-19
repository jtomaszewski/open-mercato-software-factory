import { describe, expect, it } from '@jest/globals'
import { AGENT_ROSTER, findRosterEntry, rosterAgentDefinitionIds, rosterProcessNames } from '../agentRoster'

describe('agent roster', () => {
  it('names one delegatable role in v1: the Software Engineer running factory.deliver', () => {
    expect(AGENT_ROSTER.map((entry) => [entry.agentDefinitionId, entry.processName])).toEqual([['factory', 'factory.deliver']])
    expect(rosterAgentDefinitionIds()).toEqual(['factory'])
    expect(rosterProcessNames()).toEqual(['factory.deliver'])
  })

  it('resolves a row by its agent definition id and nothing else', () => {
    expect(findRosterEntry('factory')?.labelKey).toBe('task_delegation.agents.softwareEngineer')
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
