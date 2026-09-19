import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { getAgentEntry, registerFileAgent, type FileAgentFilesConfig } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import { compileOutcome } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/outcomeSchema'
import { fileAgentDescriptors } from '../../../.mercato/generated/file-agents.generated'
import { DEVELOPER_AGENT_ID, RESEARCHER_AGENT_ID } from './lib/developer'

// The Developer and the Researcher are file-defined agents (`agents/*`), so nothing is declared natively here.
export const aiAgents: AiAgentDefinition[] = []

// Workaround for @open-mercato/enterprise 0.8.0: its file-agent loader imports the manifest
// shipped inside the package before the app's `.mercato/generated` one, so an app module's
// file agents never reach the registry. Register ours from the app manifest the way the loader
// would, before it runs (it skips ids that already exist). The `files` config is the AGENT.md
// `files`/`filesBash` flags the manifest does not carry: the Developer edits and builds the
// checkout the factory prepares itself, so the runtime's own attachment/artifact sandbox stays
// off; the Researcher only reads the web and gets no file plane.
const FILE_PLANES: Record<string, FileAgentFilesConfig | undefined> = {
  [DEVELOPER_AGENT_ID]: { enabled: true, inputs: false, outputs: false, bash: true },
  [RESEARCHER_AGENT_ID]: undefined,
}

for (const descriptor of fileAgentDescriptors) {
  if (!(descriptor.id in FILE_PLANES) || getAgentEntry(descriptor.id)) continue
  const files = FILE_PLANES[descriptor.id]
  registerFileAgent({
    id: descriptor.id,
    moduleId: descriptor.moduleId,
    resultKind: descriptor.resultKind,
    schema: compileOutcome({ kind: descriptor.resultKind, schema: descriptor.outcomeSchema }).resultSchema,
    tools: descriptor.tools,
    skills: descriptor.skills,
    subAgents: descriptor.subAgents,
    label: descriptor.label,
    description: descriptor.description,
    instructions: descriptor.instructions,
    defaultProvider: descriptor.provider,
    defaultModel: descriptor.model,
    loop: descriptor.maxSteps != null ? { maxSteps: descriptor.maxSteps } : undefined,
    runtime: 'opencode',
    outcomeSchema: descriptor.outcomeSchema,
    sampleInput: descriptor.sampleInput,
    facts: descriptor.facts,
    ...(files ? { files } : {}),
    tokenUsage: descriptor.tokenUsage,
    sourceFiles: descriptor.sourceFiles,
  })
}
