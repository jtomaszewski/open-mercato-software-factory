import type { TaskDelegationLink } from '../../task_delegation/data/entities'

export type RunPullRequest = { url: string | null; number: number | null; label: string }

const PULL_REQUEST_PATH = /\/pull\/(\d+)(?:$|[/?#])/

/**
 * The run's pull request, as the list and the detail header show it.
 *
 * The stored `ref` is the label the run wrote when it opened the PR ("PR #12 · <task title>") —
 * fine in a drawer, too long for a table cell, so the number is read back off the URL and the ref
 * is only the fallback for a link that has no readable URL.
 *
 * The last `pr` link wins: a run that reopened its PR links the one it ended on.
 */
export function pullRequestLink(links: readonly TaskDelegationLink[] | null | undefined): RunPullRequest | null {
  const link = [...(links ?? [])].reverse().find((entry) => entry.kind === 'pr')
  if (!link) return null
  const matched = link.url ? PULL_REQUEST_PATH.exec(link.url)?.[1] : undefined
  const number = matched ? Number(matched) : null
  return {
    url: link.url ?? null,
    number,
    label: number === null ? link.ref : `#${number}`,
  }
}
