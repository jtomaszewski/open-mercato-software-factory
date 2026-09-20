import { describe, expect, it } from '@jest/globals'
import { REQUEST_CHANGE_TOOL } from '../ai-tools'
import {
  aiAgentExtensions,
  aiAgents,
  WEBSITE_CHANGE_PROMPT,
} from '../ai-agents'

describe('website_publishing AI agent contributions', () => {
  it('extends the installed merchandising assistant with Developer intake', () => {
    expect(aiAgents).toEqual([])
    expect(aiAgentExtensions).toEqual([
      expect.objectContaining({
        targetAgentId: 'catalog.merchandising_assistant',
        appendAllowedTools: [REQUEST_CHANGE_TOOL],
        appendSystemPrompt: WEBSITE_CHANGE_PROMPT,
      }),
    ])
  })

  it('keeps execution targets server-controlled and reports only queued work', () => {
    expect(WEBSITE_CHANGE_PROMPT).toContain('repository, agent,')
    expect(WEBSITE_CHANGE_PROMPT).toContain('server-controlled')
    expect(WEBSITE_CHANGE_PROMPT).toContain('Report the returned Task as queued')
    expect(WEBSITE_CHANGE_PROMPT).not.toContain('repoUrl')
  })

  it('asks for the queued task to be linked back to its board card', () => {
    expect(WEBSITE_CHANGE_PROMPT).toContain('markdown link')
    expect(WEBSITE_CHANGE_PROMPT).toContain('`href`')
  })
})
