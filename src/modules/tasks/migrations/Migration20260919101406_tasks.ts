import { Migration } from '@mikro-orm/migrations';

export class Migration20260919101406_tasks extends Migration {

  override name = 'Migration20260919101406';

  override up(): void | Promise<void> {
    this.addSql(`create table "tasks_delegation" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "project_id" uuid not null, "delegate_user_id" uuid not null, "delegated_by" uuid not null, "assignee_user_id" uuid not null, "process_instance_id" uuid null, "links" jsonb not null default '[]', "outcome" varchar(20) null, "close_reason" text null, "released_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "tasks_delegation_active_task_uq" on "tasks_delegation" ("organization_id", "task_id") where "released_at" is null;`);
    this.addSql(`create index "tasks_delegation_process_idx" on "tasks_delegation" ("organization_id", "process_instance_id");`);
    this.addSql(`create index "tasks_delegation_task_history_idx" on "tasks_delegation" ("organization_id", "task_id", "created_at");`);
    this.addSql(`create index "tasks_delegation_tenant_org_idx" on "tasks_delegation" ("tenant_id", "organization_id");`);

    this.addSql(`create table "tasks_process_write" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "process_instance_id" uuid not null, "step_id" varchar(100) not null, "command_id" varchar(100) not null, "result" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "tasks_process_write_step_uq" on "tasks_process_write" ("organization_id", "task_id", "process_instance_id", "step_id");`);
    this.addSql(`create index "tasks_process_write_tenant_org_idx" on "tasks_process_write" ("tenant_id", "organization_id");`);
  }

}
