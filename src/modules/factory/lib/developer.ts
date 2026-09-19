import type { ChangedFile } from './checkout'
import type { GitHubClient } from './github'

/** The orchestrator file agent (`agents/developer`) that changes the checkout inside the sidecar's sandbox. */
export const DEVELOPER_AGENT_ID = 'factory.developer'

/** The orchestrator file agent (`agents/researcher`) that reads a customer's website with `web_fetch` (SPEC-006). */
export const RESEARCHER_AGENT_ID = 'factory.researcher'

export type DeveloperTask = { id: string; title: string; description: string | null }

export type DeliveredPr = { prNumber: number; prUrl: string; prLabel: string; branch: string }

/** What the Developer agent's run left behind: the files it changed on the base it was given. */
export type DeveloperChange = { baseSha: string; files: ChangedFile[]; summary: string }

/** One branch per task. */
export function developerBranch(taskId: string): string {
  return `developer/task-${taskId.slice(0, 8)}`
}

/**
 * The PR description from the agent's summary: the part under a summary heading when the model
 * adds a preamble before it (e.g. "Perfect! … ## Podsumowanie …"), else the whole text.
 */
export function pullRequestSummary(text: string): string {
  const match = /^#{1,6}\s*(?:podsumowanie|summary)\s*$/im.exec(text)
  return (match ? text.slice(match.index + match[0].length) : text).trim()
}

export type DeveloperDeps = {
  github: GitHubClient
  /** Shown in the PR body as the author of the change. */
  agentLabel: string
  appUrl?: string | null
}

/**
 * The host commits the agent's files on the exact base it cloned and opens one PR per task. The
 * agent itself never holds the GitHub token.
 */
export async function openDeveloperPullRequest(deps: DeveloperDeps, task: DeveloperTask, change: DeveloperChange): Promise<DeliveredPr> {
  const branch = developerBranch(task.id)
  const title = task.title.length > 120 ? `${task.title.slice(0, 117)}...` : task.title
  const taskLink = deps.appUrl ? `${deps.appUrl.replace(/\/$/, '')}/backend/staff/time-tracking` : null
  const body = [
    pullRequestSummary(change.summary) || 'Zmiana przygotowana przez agenta Developer.',
    '',
    '---',
    `Zadanie z tablicy Open Mercato: **${task.title}**${taskLink ? ` (${taskLink})` : ''}.`,
    `Przygotował ${deps.agentLabel}, na bazie \`${change.baseSha.slice(0, 7)}\`.`,
    `Zmienione pliki: ${change.files.map((file) => `\`${file.path}\`${file.content === null ? ' (usunięty)' : ''}`).join(', ')}.`,
  ].join('\n')
  const commitSha = await deps.github.createCommit({ parentSha: change.baseSha, files: change.files, message: title })
  await deps.github.upsertBranch(branch, commitSha)
  const pr = await deps.github.createPullRequest({ title, body, head: branch })
  return { prNumber: pr.number, prUrl: pr.htmlUrl, prLabel: `PR #${pr.number} · ${task.title.slice(0, 60)}`, branch }
}
