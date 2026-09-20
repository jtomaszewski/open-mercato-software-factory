import { Migration } from '@mikro-orm/migrations';

export class Migration20260920033819_code_changes extends Migration {

  override name = 'Migration20260920033819';

  override up(): void | Promise<void> {
    this.addSql(`create table "code_changes_change_requests" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "delegation_id" uuid null, "project_id" uuid not null, "repository_id" uuid null, "title" text not null, "summary" text null, "provider" varchar(20) not null default 'github', "repo_full_name" varchar(200) not null, "base_branch" varchar(255) not null, "branch" varchar(255) null, "number" int null, "url" text null, "head_sha" varchar(64) null, "merge_commit_sha" varchar(64) null, "status" varchar(20) not null default 'generating', "status_reason" text null, "opened_by" uuid not null, "decided_by" uuid null, "decided_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "code_changes_change_requests_delegation_uq" on "code_changes_change_requests" ("organization_id", "delegation_id") where "delegation_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "code_changes_change_requests_task_idx" on "code_changes_change_requests" ("organization_id", "task_id");`);
    this.addSql(`create index "code_changes_change_requests_scope_idx" on "code_changes_change_requests" ("tenant_id", "organization_id");`);
  }

}
