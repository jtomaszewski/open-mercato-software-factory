import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { getAgentEntry, registerFileAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import { compileOutcome } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/outcomeSchema'
import { fileAgentDescriptors } from '../../../.mercato/generated/file-agents.generated'
import { DEVELOPER_AGENT_ID } from './lib/developer'

// The Developer is a file-defined agent (`agents/developer`), so nothing is declared natively here.
export const aiAgents: AiAgentDefinition[] = []

// Workaround for @open-mercato/enterprise 0.8.0: its file-agent loader imports the manifest
// shipped inside the package before the app's `.mercato/generated` one, so an app module's
// file agents never reach the registry. Register ours from the app manifest the way the loader
// would, before it runs (it skips ids that already exist). The `files` config is the AGENT.md
// `files`/`filesBash` flags the manifest does not carry: the agent edits and builds the checkout
// the factory prepares itself, so the runtime's own attachment/artifact sandbox stays off.
const developer = fileAgentDescriptors.find((descriptor) => descriptor.id === DEVELOPER_AGENT_ID)
if (developer && !getAgentEntry(DEVELOPER_AGENT_ID)) {
  registerFileAgent({
    id: developer.id,
    moduleId: developer.moduleId,
    resultKind: developer.resultKind,
    schema: compileOutcome({ kind: developer.resultKind, schema: developer.outcomeSchema }).resultSchema,
    tools: developer.tools,
    skills: developer.skills,
    subAgents: developer.subAgents,
    label: developer.label,
    description: developer.description,
    instructions: developer.instructions,
    defaultProvider: developer.provider,
    defaultModel: developer.model,
    loop: developer.maxSteps != null ? { maxSteps: developer.maxSteps } : undefined,
    runtime: 'opencode',
    outcomeSchema: developer.outcomeSchema,
    sampleInput: developer.sampleInput,
    facts: developer.facts,
    files: { enabled: true, inputs: false, outputs: false, bash: true },
    tokenUsage: developer.tokenUsage,
    sourceFiles: developer.sourceFiles,
  })
}
