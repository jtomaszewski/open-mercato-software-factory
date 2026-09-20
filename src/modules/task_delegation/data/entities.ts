import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import type { DelegationOutcome } from '../lib/transitionPolicy'

export type TaskDelegationLinkKind = 'pr' | 'caseload' | 'artifact' | 'instance' | 'run' | 'change'
export type TaskDelegationLink = {
  kind: TaskDelegationLinkKind
  ref: string
  url?: string | null
  addedAt: string
}

@Entity({ tableName: 'task_delegations' })
@Index({ name: 'task_delegations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'task_delegations_task_history_idx', properties: ['organizationId', 'taskId', 'createdAt'] })
@Index({ name: 'task_delegations_process_idx', properties: ['organizationId', 'processInstanceId'] })
@Index({
  name: 'task_delegations_active_task_uq',
  expression: 'create unique index "task_delegations_active_task_uq" on "task_delegations" ("organization_id", "task_id") where "released_at" is null',
})
export class TaskDelegation {
  [OptionalProps]?: 'processInstanceId' | 'links' | 'outcome' | 'closeReason' | 'releasedAt' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'task_id', type: 'uuid' }) taskId!: string
  @Property({ name: 'project_id', type: 'uuid' }) projectId!: string
  @Property({ name: 'delegate_user_id', type: 'uuid' }) delegateUserId!: string
  @Property({ name: 'delegated_by', type: 'uuid' }) delegatedBy!: string
  @Property({ name: 'assignee_user_id', type: 'uuid' }) assigneeUserId!: string
  @Property({ name: 'process_instance_id', type: 'uuid', nullable: true }) processInstanceId?: string | null
  @Property({ type: 'jsonb', default: '[]' }) links: TaskDelegationLink[] = []
  @Property({ type: 'varchar', length: 20, nullable: true }) outcome?: DelegationOutcome | null
  @Property({ name: 'close_reason', type: 'text', nullable: true }) closeReason?: string | null
  @Property({ name: 'released_at', type: Date, nullable: true }) releasedAt?: Date | null
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() }) updatedAt: Date = new Date()
}

@Entity({ tableName: 'task_delegation_process_writes' })
@Index({ name: 'task_delegation_process_writes_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'task_delegation_process_writes_step_uq',
  expression: 'create unique index "task_delegation_process_writes_step_uq" on "task_delegation_process_writes" ("organization_id", "task_id", "process_instance_id", "step_id")',
})
export class TaskProcessWrite {
  [OptionalProps]?: 'result' | 'createdAt' | 'updatedAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'task_id', type: 'uuid' }) taskId!: string
  @Property({ name: 'process_instance_id', type: 'uuid' }) processInstanceId!: string
  @Property({ name: 'step_id', type: 'varchar', length: 100 }) stepId!: string
  @Property({ name: 'command_id', type: 'varchar', length: 100 }) commandId!: string
  @Property({ type: 'jsonb', nullable: true }) result?: unknown
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()
  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() }) updatedAt: Date = new Date()
}
