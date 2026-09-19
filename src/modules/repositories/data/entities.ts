import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type RepositoryProfileKind = 'pr_only' | 'static_site'
export type RepositoryStatus = 'active' | 'disabled'
export type RepositoryAccessStatus = 'granted' | 'unavailable'
export type QualificationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'stale'

@Entity({ tableName: 'repositories_connections' })
@Index({
  name: 'repositories_connections_provider_installation_uq',
  expression: 'create unique index "repositories_connections_provider_installation_uq" on "repositories_connections" ("provider", "installation_id") where "deleted_at" is null',
})
@Index({ name: 'repositories_connections_scope_idx', properties: ['tenantId', 'organizationId'] })
export class RepositoryConnection {
  [OptionalProps]?: 'provider' | 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'varchar', length: 20, default: 'github' })
  provider: 'github' = 'github'

  @Property({ name: 'installation_id', type: 'varchar', length: 32 })
  installationId!: string

  @Property({ name: 'broker_authorization_id', type: 'uuid' })
  brokerAuthorizationId!: string

  @Property({ name: 'account_login', type: 'varchar', length: 100 })
  accountLogin!: string

  @Property({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'suspended' | 'removed' = 'active'

  @Property({ name: 'connected_by', type: 'uuid' })
  connectedBy!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'repositories_connect_states' })
@Unique({ name: 'repositories_connect_states_nonce_uq', properties: ['nonceHash'] })
@Index({ name: 'repositories_connect_states_scope_idx', properties: ['tenantId', 'organizationId', 'userId'] })
export class RepositoryConnectState {
  [OptionalProps]?: 'expectedInstallationId' | 'usedAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'nonce_hash', type: 'varchar', length: 64 })
  nonceHash!: string

  @Property({ name: 'expected_installation_id', type: 'varchar', length: 32, nullable: true })
  expectedInstallationId?: string | null

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'repositories_repositories' })
@Index({
  name: 'repositories_repositories_org_github_uq',
  expression: 'create unique index "repositories_repositories_org_github_uq" on "repositories_repositories" ("organization_id", "github_repository_id") where "deleted_at" is null',
})
@Index({ name: 'repositories_repositories_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'repositories_repositories_connection_idx', properties: ['connectionId'] })
export class CodeRepository {
  [OptionalProps]?:
    | 'configEpoch'
    | 'qualificationStatus'
    | 'qualificationEpoch'
    | 'qualificationReport'
    | 'status'
    | 'accessStatus'
    | 'qualificationAttemptId'
    | 'qualificationStartedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'connection_id', type: 'uuid' })
  connectionId!: string

  @Property({ name: 'github_repository_id', type: 'varchar', length: 32 })
  githubRepositoryId!: string

  @Property({ name: 'full_name', type: 'varchar', length: 200 })
  fullName!: string

  @Property({ name: 'base_branch', type: 'varchar', length: 255 })
  baseBranch!: string

  @Property({ type: 'varchar', length: 20 })
  kind!: RepositoryProfileKind

  @Property({ type: 'json' })
  profile!: Record<string, unknown>

  @Property({ name: 'config_epoch', type: 'integer', default: 1 })
  configEpoch: number = 1

  @Property({ name: 'qualification_status', type: 'varchar', length: 20, default: 'pending' })
  qualificationStatus: QualificationStatus = 'pending'

  @Property({ name: 'qualification_epoch', type: 'integer', nullable: true })
  qualificationEpoch?: number | null

  @Property({ name: 'qualification_report', type: 'json', nullable: true })
  qualificationReport?: Record<string, unknown> | null

  @Property({ type: 'varchar', length: 20, default: 'active' })
  status: RepositoryStatus = 'active'

  @Property({ name: 'access_status', type: 'varchar', length: 20, default: 'granted' })
  accessStatus: RepositoryAccessStatus = 'granted'

  @Property({ name: 'qualification_attempt_id', type: 'uuid', nullable: true })
  qualificationAttemptId?: string | null

  @Property({ name: 'qualification_started_at', type: Date, nullable: true })
  qualificationStartedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'repositories_project_links' })
@Unique({ name: 'repositories_project_links_org_project_repository_uq', properties: ['organizationId', 'projectId', 'repositoryId'] })
@Index({
  name: 'repositories_project_links_org_project_default_uq',
  expression: 'create unique index "repositories_project_links_org_project_default_uq" on "repositories_project_links" ("organization_id", "project_id") where "is_default" is true',
})
@Index({ name: 'repositories_project_links_scope_project_idx', properties: ['tenantId', 'organizationId', 'projectId'] })
export class RepositoryProjectLink {
  [OptionalProps]?: 'isDefault' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'project_id', type: 'uuid' }) projectId!: string
  @Property({ name: 'repository_id', type: 'uuid' }) repositoryId!: string
  @Property({ name: 'is_default', type: 'boolean', default: false }) isDefault: boolean = false
  @Property({ name: 'created_by', type: 'uuid' }) createdBy!: string
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() }) updatedAt: Date = new Date()
}

@Entity({ tableName: 'repositories_qualification_dispatches' })
@Unique({ name: 'repositories_qualification_dispatches_attempt_uq', properties: ['attemptId'] })
@Index({ name: 'repositories_qualification_dispatches_repository_idx', properties: ['repositoryId'] })
export class RepositoryQualificationDispatch {
  [OptionalProps]?: 'status' | 'lastErrorCode' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'repository_id', type: 'uuid' })
  repositoryId!: string

  @Property({ name: 'attempt_id', type: 'uuid' })
  attemptId!: string

  @Property({ type: 'integer' })
  epoch!: number

  @Property({ type: 'varchar', length: 20, default: 'pending' })
  status: 'pending' | 'accepted' | 'failed' = 'pending'

  @Property({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  lastErrorCode?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'repositories_event_intents' })
@Index({ name: 'repositories_event_intents_scope_delivery_idx', properties: ['tenantId', 'organizationId', 'deliveredAt'] })
export class RepositoryEventIntent {
  [OptionalProps]?: 'deliveredAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'event_id', type: 'varchar', length: 100 })
  eventId!: string

  @Property({ type: 'json' })
  payload!: Record<string, unknown>

  @Property({ name: 'delivered_at', type: Date, nullable: true })
  deliveredAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'repositories_broker_replays' })
@Unique({ name: 'repositories_broker_replays_direction_request_uq', properties: ['direction', 'requestId'] })
export class RepositoryBrokerReplay {
  [OptionalProps]?: 'claimedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'varchar', length: 20 })
  direction!: 'callback'

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ name: 'key_id', type: 'varchar', length: 100 })
  keyId!: string

  @Property({ name: 'claimed_at', type: Date, onCreate: () => new Date() })
  claimedAt: Date = new Date()
}
