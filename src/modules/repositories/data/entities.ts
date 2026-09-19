import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type RepositoryStatus = 'active' | 'disabled'

/** One GitHub App installation bound to an organization after its OAuth consent was verified. */
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

  /**
   * GitHub repository IDs the connecting user could push to when consenting. Later reads intersect
   * the installation's current grant with this set, so a refresh can shrink access but never widen it.
   */
  @Property({ name: 'authorized_repository_ids', type: 'json' })
  authorizedRepositoryIds!: string[]

  @Property({ name: 'account_login', type: 'varchar', length: 100 })
  accountLogin!: string

  @Property({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'removed' = 'active'

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
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ type: 'varchar', length: 20, default: 'active' })
  status: RepositoryStatus = 'active'

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
