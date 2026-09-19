import { createHash } from 'node:crypto'

export type RepositoryTargetOption = { id: string; isDefault: boolean; usable: boolean }

export function chooseRepositoryTarget<Target extends RepositoryTargetOption>(targets: Target[], repositoryId?: string): Target {
  const selected = repositoryId ? targets.find((item) => item.id === repositoryId) : undefined
  if (repositoryId && !selected) throw new Error('repository_not_linked')
  if (selected && !selected.usable) throw new Error('repository_not_qualified')
  const usable = targets.filter((item) => item.usable)
  const target = selected ?? (usable.length === 1 ? usable[0] : usable.find((item) => item.isDefault))
  if (!target) throw new Error(targets.length > 0 && usable.length === 0 ? 'repository_not_qualified' : 'repository_required')
  return target
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, ordered(item)]))
  }
  return value
}

export function repositoryProfileDigest(profile: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(ordered(profile))).digest('hex')
}
