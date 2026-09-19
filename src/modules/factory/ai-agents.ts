import {
  defineAiAgentExtension,
  type AiAgentDefinition,
  type AiAgentExtension,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { getAgentEntry, registerFileAgent, type FileAgentFilesConfig } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import { compileOutcome } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/outcomeSchema'
import { fileAgentDescriptors } from '../../../.mercato/generated/file-agents.generated'
import { FACTORY_REQUEST_CHANGE_TOOL } from './ai-tools'
import { DEVELOPER_AGENT_ID, RESEARCHER_AGENT_ID } from './lib/developer'

// The Developer and the Researcher are file-defined agents (`agents/*`), so nothing is declared natively here.
export const aiAgents: AiAgentDefinition[] = []

export const FACTORY_MERCHANDISING_PROMPT = [
  'WEBSITE AND CODE CHANGE HANDOFF',
  `When the operator asks for a website or code change, call ${FACTORY_REQUEST_CHANGE_TOOL}.`,
  'For a catalog-backed request, first resolve the concrete product and complete any requested',
  'catalog mutation. Then pass the product UUID and concrete website acceptance criteria to the',
  'change request. The tool creates a DEMO Task and delegates it to Developer; repository, agent,',
  'runtime, model, and work directory are server-controlled and must never be requested from the',
  'operator. Report the returned Task as queued. Never claim the website is changed, published,',
  'deployed, or merged until a later task status proves that outcome.',
].join('\n')

// Lend the app-owned intake tool to the shipped catalog chat without replacing the agent.
export const aiAgentExtensions: AiAgentExtension[] = [
  defineAiAgentExtension({
    targetAgentId: 'catalog.merchandising_assistant',
    appendAllowedTools: [FACTORY_REQUEST_CHANGE_TOOL],
    appendSystemPrompt: FACTORY_MERCHANDISING_PROMPT,
  }),
]

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
