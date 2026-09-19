import type { CodeRepository, RepositoryAccessStatus } from '../data/entities'

type InstallationGrant = { id: string; fullName: string }

export function applyAuthoritativeProviderGrant(
  repository: Pick<CodeRepository, 'githubRepositoryId' | 'fullName' | 'accessStatus' | 'status'>,
  grant: InstallationGrant | null,
): void {
  repository.accessStatus = grant ? 'granted' : 'unavailable'
  if (grant) repository.fullName = grant.fullName
}

export function shouldRequalifyAfterProviderGrant(
  previousAccessStatus: RepositoryAccessStatus,
  currentAccessStatus: RepositoryAccessStatus,
): boolean {
  return previousAccessStatus === 'unavailable' && currentAccessStatus === 'granted'
}
