import type { CatalogRecordView } from './catalogRecord'
import type { GitHubClient } from './github'
import { runDeveloperAgent, type RunnerConfig, type RunnerResult } from './runner'

export type DeveloperTask = { id: string; title: string; description: string | null }

export type DeliveredPr = { prNumber: number; prUrl: string; prLabel: string; branch: string; reused: boolean }

/** One branch per task, so a retried run finds its PR instead of running the agent again. */
export function developerBranch(taskId: string): string {
  return `developer/task-${taskId.slice(0, 8)}`
}

export function buildDeveloperPrompt(task: DeveloperTask, record: CatalogRecordView | null): string {
  return [
    'You are the Developer agent of Open Mercato. The Stal-Zbiorniki website repository is checked out in /work (a Next.js static site).',
    'Do the task below as a pull request would: the smallest complete change, consistent with the existing code.',
    '',
    '## Task (from the Open Mercato task board)',
    task.title,
    '',
    task.description?.trim() || '(no description)',
    ...(record ? [
      '',
      '## Catalog record (the source of truth for product data; do not invent values)',
      '```json',
      JSON.stringify(record, null, 2),
      '```',
    ] : []),
    '',
    '## Rules',
    '- Read AGENTS.md first and follow it exactly (file layout, the product mapping table, the registry).',
    '- Never edit .github/, vercel.json or anything outside the repository; do not add dependencies unless the task needs them.',
    '- Run `npm ci`, then `npm run lint`, `npm run typecheck` and `npm run build`. Fix what you broke until all of them pass.',
    '- Do not commit, push or create branches: leave your changes in the working tree. The platform opens the pull request.',
    '- Your final message must be only a summary of 2-4 sentences in Polish describing what you changed, with no preamble or heading; it becomes the pull request description.',
  ].join('\n')
}

/**
 * The PR description from the agent's last message: the part under a summary heading when the
 * model adds a preamble before it (e.g. "Perfect! … ## Podsumowanie …"), else the whole text.
 */
export function pullRequestSummary(text: string): string {
  const match = /^#{1,6}\s*(?:podsumowanie|summary)\s*$/im.exec(text)
  return (match ? text.slice(match.index + match[0].length) : text).trim()
}

export type DeveloperDeps = {
  github: GitHubClient
  config: RunnerConfig
  run?: typeof runDeveloperAgent
  appUrl?: string | null
}

/**
 * EX-P0 effector: the Developer agent changes a checkout in its container; the host commits the
 * result on the exact base it cloned and opens one PR per task. An open PR for the task's branch
 * is reused, so a retry never runs the agent twice.
 */
export async function deliverWithDeveloper(deps: DeveloperDeps, task: DeveloperTask, record: CatalogRecordView | null): Promise<DeliveredPr> {
  const branch = developerBranch(task.id)
  const label = (number: number) => `PR #${number} · ${task.title.slice(0, 60)}`
  const existing = await deps.github.findOpenPullRequest(branch)
  if (existing) return { prNumber: existing.number, prUrl: existing.htmlUrl, prLabel: label(existing.number), branch, reused: true }

  const result: RunnerResult = await (deps.run ?? runDeveloperAgent)(deps.config, { runId: task.id, prompt: buildDeveloperPrompt(task, record) })
  const title = task.title.length > 120 ? `${task.title.slice(0, 117)}...` : task.title
  const taskLink = deps.appUrl ? `${deps.appUrl.replace(/\/$/, '')}/backend/staff/time-tracking` : null
  const body = [
    pullRequestSummary(result.summary) || 'Zmiana przygotowana przez agenta Developer.',
    '',
    '---',
    `Zadanie z tablicy Open Mercato: **${task.title}**${taskLink ? ` (${taskLink})` : ''}.`,
    `Przygotował agent Developer (OpenCode, ${deps.config.model}) w jednorazowym kontenerze, na bazie \`${result.baseSha.slice(0, 7)}\`, w ${Math.round(result.durationMs / 1000)} s.`,
    `Zmienione pliki: ${result.files.map((file) => `\`${file.path}\`${file.content === null ? ' (usunięty)' : ''}`).join(', ')}.`,
  ].join('\n')
  const commitSha = await deps.github.createCommit({ parentSha: result.baseSha, files: result.files, message: title })
  await deps.github.upsertBranch(branch, commitSha)
  const pr = await deps.github.createPullRequest({ title, body, head: branch })
  return { prNumber: pr.number, prUrl: pr.htmlUrl, prLabel: label(pr.number), branch, reused: false }
}
