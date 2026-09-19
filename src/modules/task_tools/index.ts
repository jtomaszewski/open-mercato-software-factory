import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

/**
 * SPEC-007 — task management AI tools for MCP clients.
 *
 * Owns no records: the five tools in `ai-tools.ts` read and write `staff` tasks,
 * projects and comments through the installed `staff` HTTP routes, so route ACL,
 * project-membership narrowing, validation, commands and events apply unchanged.
 */
export const metadata: ModuleInfo = {
  name: 'task_tools',
  title: 'Task tools',
  version: '0.1.0',
  description: 'MCP/AI tools to create, read, search and comment on staff board tasks.',
  author: 'HackOn team',
  license: 'MIT',
  requires: ['staff', 'ai_assistant'],
}
