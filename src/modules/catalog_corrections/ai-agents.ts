import { defineAiAgentExtension, type AiAgentExtension } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

export const aiAgentExtensions: AiAgentExtension[] = [defineAiAgentExtension({
  targetAgentId: 'catalog.merchandising_assistant',
  appendAllowedTools: ['catalog_corrections.correct_capacity'],
  appendSystemPrompt: [
    'For a product capacity correction in whole litres, use catalog_corrections.correct_capacity.',
    'It updates metadata.capacityLiters together with matching litre quantities in the title and description.',
    'catalog.update_product changes copy only and cannot correct stored capacity.',
    'Use only the capacity explicitly supplied by the user, and identify the exact product first.',
    'The tool produces a human approval card. Do not report the correction as saved before confirmation succeeds.',
    'Keep SKU, dimensions, price and unrelated specifications unchanged.',
  ].join(' '),
})]
