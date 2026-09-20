import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Where a change request is in its life.
 *
 * `generating` exists because the interesting part of a change request starts before there is
 * anything to look at: the agent is working, and a business owner watching the list wants to see
 * that, not a gap. `failed` is a change request that never produced one — kept rather than
 * deleted, because "we tried and it did not work" is the answer to a question someone will ask.
 */
export type ChangeRequestStatus = 'generating' | 'open' | 'approved' | 'rejected' | 'failed'

/**
 * One proposed change to a repository — a GitHub pull request, in the words a person who does not
 * work with git can act on.
 *
 * It is a record of our own, not a mirror of GitHub: the provider fields are a snapshot taken when
 * the change was proposed, and the decision fields (`decidedBy`, `decidedAt`, `statusReason`) are
 * ours alone, because "who approved this, when, and why" is the part an audit asks about and the
 * part GitHub cannot answer for a person who never had a GitHub account.
 *
 * Cross-module references are ids and snapshots by value (`taskId`, `delegationId`, `projectId`,
 * `repositoryId`, `repoFullName`): a change request outlives the task it came from and stays
 * readable when the repository it targeted has been unregistered.
 */
@Entity({ tableName: 'code_changes_change_requests' })
@Index({ name: 'code_changes_change_requests_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'code_changes_change_requests_task_idx', properties: ['organizationId', 'taskId'] })
@Index({
  name: 'code_changes_change_requests_delegation_uq',
  expression: 'create unique index "code_changes_change_requests_delegation_uq" on "code_changes_change_requests" ("organization_id", "delegation_id") where "delegation_id" is not null and "deleted_at" is null',
})
export class ChangeRequest {
  [OptionalProps]?: 'status' | 'provider' | 'summary' | 'branch' | 'number' | 'url' | 'headSha'
    | 'mergeCommitSha' | 'statusReason' | 'decidedBy' | 'decidedAt' | 'delegationId' | 'repositoryId'
    | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string

  /** The board task this change was asked for on. */
  @Property({ name: 'task_id', type: 'uuid' }) taskId!: string
  /** The agent run that produced it; null for a change request raised outside a delegated run. */
  @Property({ name: 'delegation_id', type: 'uuid', nullable: true }) delegationId?: string | null
  @Property({ name: 'project_id', type: 'uuid' }) projectId!: string
  /** The registered repository, when the change targeted one rather than the environment default. */
  @Property({ name: 'repository_id', type: 'uuid', nullable: true }) repositoryId?: string | null

  @Property({ type: 'text' }) title!: string
  /** What the agent said it changed, in its own words. */
  @Property({ type: 'text', nullable: true }) summary?: string | null

  @Property({ type: 'varchar', length: 20, default: 'github' }) provider: 'github' = 'github'
  /** `owner/name` at the time of the proposal — a snapshot, never resolved through a relation. */
  @Property({ name: 'repo_full_name', type: 'varchar', length: 200 }) repoFullName!: string
  @Property({ name: 'base_branch', type: 'varchar', length: 255 }) baseBranch!: string
  @Property({ type: 'varchar', length: 255, nullable: true }) branch?: string | null

  @Property({ type: 'integer', nullable: true }) number?: number | null
  @Property({ type: 'text', nullable: true }) url?: string | null
  @Property({ name: 'head_sha', type: 'varchar', length: 64, nullable: true }) headSha?: string | null
  @Property({ name: 'merge_commit_sha', type: 'varchar', length: 64, nullable: true }) mergeCommitSha?: string | null

  @Property({ type: 'varchar', length: 20, default: 'generating' }) status: ChangeRequestStatus = 'generating'
  /** Why it failed, or why it was rejected — the sentence a person reads, never a code. */
  @Property({ name: 'status_reason', type: 'text', nullable: true }) statusReason?: string | null

  @Property({ name: 'opened_by', type: 'uuid' }) openedBy!: string
  @Property({ name: 'decided_by', type: 'uuid', nullable: true }) decidedBy?: string | null
  @Property({ name: 'decided_at', type: Date, nullable: true }) decidedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() }) updatedAt: Date = new Date()
  @Property({ name: 'deleted_at', type: Date, nullable: true }) deletedAt?: Date | null
}
