import { describe, expect, it } from '@jest/globals'
import { agentStepDetail, agentStepKind, normalizeToolName } from '../lib/agentSteps'

describe('agentStepKind', () => {
  it('says what the agent was doing, not which tool it called', () => {
    expect(agentStepKind('read')).toBe('reading')
    expect(agentStepKind('edit')).toBe('editing')
    expect(agentStepKind('bash')).toBe('building')
    expect(agentStepKind('web_fetch')).toBe('researching')
  })

  it('reads the persisted and the live name of the same tool identically', () => {
    // The persisted trace keeps the full MCP id; the live progress event is emitted already
    // shortened. A feed that merges both must not show one call under two labels.
    expect(normalizeToolName('open-mercato_agent_orchestrator_submit_outcome')).toBe('submit_outcome')
    expect(agentStepKind('open-mercato_agent_orchestrator_submit_outcome')).toBe(agentStepKind('submit_outcome'))
  })

  it('never leaves a tool unexplained', () => {
    expect(agentStepKind('some_tool_added_next_release')).toBe('thinking')
  })
})

describe('agentStepDetail', () => {
  it('shows the command, the file or the query', () => {
    expect(agentStepDetail({ command: 'npm run build' })).toBe('npm run build')
    expect(agentStepDetail({ filePath: '/work/app/page.tsx' })).toBe('/work/app/page.tsx')
    expect(agentStepDetail({ query: 'metal zbiorniki' })).toBe('metal zbiorniki')
  })

  it('never spills an argument payload it was not asked for', () => {
    expect(agentStepDetail({ apiKey: 'secret', body: 'long' })).toBeNull()
    expect(agentStepDetail('a string')).toBeNull()
    expect(agentStepDetail(null)).toBeNull()
  })

  it('stays one line long', () => {
    const detail = agentStepDetail({ command: `echo ${'x'.repeat(400)}` })
    expect(detail).not.toBeNull()
    expect((detail as string).length).toBeLessThanOrEqual(160)
    expect(agentStepDetail({ command: 'npm ci\n  && npm run build' })).toBe('npm ci && npm run build')
  })
})
