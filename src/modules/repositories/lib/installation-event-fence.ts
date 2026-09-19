import type { RepositoryConnection } from '../data/entities'

export type RepositoryConnectionBinding = Pick<RepositoryConnection, 'id' | 'updatedAt' | 'brokerAuthorizationId'>

export function snapshotRepositoryConnectionBinding(connection: RepositoryConnectionBinding): RepositoryConnectionBinding {
  return {
    id: connection.id,
    updatedAt: new Date(connection.updatedAt),
    brokerAuthorizationId: connection.brokerAuthorizationId,
  }
}

export function isRepositoryConnectionBindingCurrent(
  connection: RepositoryConnectionBinding,
  observed: RepositoryConnectionBinding,
): boolean {
  return connection.id === observed.id
    && connection.updatedAt.getTime() === observed.updatedAt.getTime()
    && connection.brokerAuthorizationId === observed.brokerAuthorizationId
}
