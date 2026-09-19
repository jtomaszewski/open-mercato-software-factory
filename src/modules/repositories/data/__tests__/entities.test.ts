import { MetadataStorage } from '@mikro-orm/core'
import { describe, expect, it } from '@jest/globals'
import { CodeRepository, RepositoryConnection } from '../entities'

function activeUniqueIndexExpression(className: string, indexName: string): string | undefined {
  const metadata = Object.values(MetadataStorage.getMetadata()).find((candidate) => candidate.className === className)
  if (!metadata) throw new Error(`[internal] ${className} decorator metadata was not registered`)
  return metadata.indexes.find((index) => index.name === indexName)?.expression as string | undefined
}

describe('repository active-row uniqueness', () => {
  it('allows a removed installation to be connected again', () => {
    expect(activeUniqueIndexExpression(RepositoryConnection.name, 'repositories_connections_provider_installation_uq')).toBe(
      'create unique index "repositories_connections_provider_installation_uq" on "repositories_connections" ("provider", "installation_id") where "deleted_at" is null',
    )
  })

  it('allows a removed repository to be registered again', () => {
    expect(activeUniqueIndexExpression(CodeRepository.name, 'repositories_repositories_org_github_uq')).toBe(
      'create unique index "repositories_repositories_org_github_uq" on "repositories_repositories" ("organization_id", "github_repository_id") where "deleted_at" is null',
    )
  })
})
