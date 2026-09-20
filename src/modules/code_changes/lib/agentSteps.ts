/**
 * What one agent tool call means to the person watching the change being made.
 *
 * The reader of a change request is the person who will approve it, not the person who wrote the
 * agent: `bash` and `edit` say nothing to them. Every tool the Developer and the Researcher may
 * call is therefore mapped onto one of a handful of business kinds, and the raw tool name plus its
 * arguments stay available underneath for whoever does want them.
 *
 * Shared by the server (persisted tool calls, which carry full arguments) and the browser (live
 * `agent_orchestrator.run.progress` events, which carry only the tool name), so this file must
 * stay free of server-only imports.
 */
export type AgentStepKind = 'reading' | 'editing' | 'building' | 'researching' | 'reporting' | 'thinking'

/**
 * The tool names the OpenCode runtime emits, bare. The orchestrator's own MCP tools arrive
 * prefixed on the persisted trace and unprefixed on the live event, so both are normalized first.
 */
const KIND_BY_TOOL: Record<string, AgentStepKind> = {
  read: 'reading',
  list: 'reading',
  ls: 'reading',
  glob: 'reading',
  grep: 'reading',
  write: 'editing',
  edit: 'editing',
  patch: 'editing',
  multiedit: 'editing',
  bash: 'building',
  web_search: 'researching',
  web_fetch: 'researching',
  webfetch: 'researching',
  submit_outcome: 'reporting',
  load_skill: 'thinking',
  run_skill_script: 'thinking',
  todowrite: 'thinking',
  task: 'thinking',
}

/** `open-mercato_agent_orchestrator_submit_outcome` → `submit_outcome`. Idempotent. */
export function normalizeToolName(tool: string): string {
  return tool.replace(/^open-mercato_agent_orchestrator_/, '').trim().toLowerCase()
}

export function agentStepKind(tool: string): AgentStepKind {
  return KIND_BY_TOOL[normalizeToolName(tool)] ?? 'thinking'
}

const DETAIL_KEYS = ['command', 'filePath', 'file_path', 'path', 'pattern', 'query', 'url', 'q', 'description'] as const
const MAX_DETAIL = 160

/**
 * A one-line technical detail for a tool call — the shell command, the file, the query. Read only
 * from a known key set so an unexpected argument shape can never spill a whole payload onto the
 * page, and truncated because this renders on one line.
 */
export function agentStepDetail(request: unknown): string | null {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null
  const record = request as Record<string, unknown>
  for (const key of DETAIL_KEYS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (!trimmed) continue
    return trimmed.length > MAX_DETAIL ? `${trimmed.slice(0, MAX_DETAIL - 1)}…` : trimmed
  }
  return null
}
