import { describe, expect, it } from '@jest/globals'
import { FACTORY_REQUEST_CHANGE_TOOL } from '../ai-tools'
import {
  aiAgentExtensions,
  aiAgents,
  FACTORY_MERCHANDISING_PROMPT,
} from '../ai-agents'

describe('factory AI agent contributions', () => {
  it('extends the installed merchandising assistant with Developer intake', () => {
    expect(aiAgents).toEqual([])
    expect(aiAgentExtensions).toEqual([
      expect.objectContaining({
        targetAgentId: 'catalog.merchandising_assistant',
        appendAllowedTools: [FACTORY_REQUEST_CHANGE_TOOL],
        appendSystemPrompt: FACTORY_MERCHANDISING_PROMPT,
      }),
    ])
  })

  it('keeps execution targets server-controlled and reports only queued work', () => {
    expect(FACTORY_MERCHANDISING_PROMPT).toContain('repository, agent,')
    expect(FACTORY_MERCHANDISING_PROMPT).toContain('server-controlled')
    expect(FACTORY_MERCHANDISING_PROMPT).toContain('Report the returned Task as queued')
    expect(FACTORY_MERCHANDISING_PROMPT).not.toContain('repoUrl')
  })
})
