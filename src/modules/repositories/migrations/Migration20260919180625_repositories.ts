import { Migration } from '@mikro-orm/migrations';

export class Migration20260919180625_repositories extends Migration {

  override name = 'Migration20260919180625';

  override up(): void | Promise<void> {
    this.addSql(`create table "repositories_repositories" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "connection_id" uuid not null, "github_repository_id" varchar(32) not null, "full_name" varchar(200) not null, "base_branch" varchar(255) not null, "status" varchar(20) not null default 'active', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "repositories_repositories_connection_idx" on "repositories_repositories" ("connection_id");`);
    this.addSql(`create index "repositories_repositories_scope_idx" on "repositories_repositories" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "repositories_repositories_org_github_uq" on "repositories_repositories" ("organization_id", "github_repository_id") where "deleted_at" is null;`);

    this.addSql(`create table "repositories_connections" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "provider" varchar(20) not null default 'github', "installation_id" varchar(32) not null, "authorized_repository_ids" jsonb not null, "account_login" varchar(100) not null, "status" varchar(20) not null default 'active', "connected_by" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "repositories_connections_scope_idx" on "repositories_connections" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "repositories_connections_provider_installation_uq" on "repositories_connections" ("provider", "installation_id") where "deleted_at" is null;`);

    this.addSql(`create table "repositories_connect_states" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "nonce_hash" varchar(64) not null, "expected_installation_id" varchar(32) null, "expires_at" timestamptz not null, "used_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "repositories_connect_states_scope_idx" on "repositories_connect_states" ("tenant_id", "organization_id", "user_id");`);
    this.addSql(`alter table "repositories_connect_states" add constraint "repositories_connect_states_nonce_uq" unique ("nonce_hash");`);

    this.addSql(`create table "repositories_project_links" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "repository_id" uuid not null, "is_default" boolean not null default false, "created_by" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "repositories_project_links_scope_project_idx" on "repositories_project_links" ("tenant_id", "organization_id", "project_id");`);
    this.addSql(`create unique index "repositories_project_links_org_project_default_uq" on "repositories_project_links" ("organization_id", "project_id") where "is_default" is true;`);
    this.addSql(`alter table "repositories_project_links" add constraint "repositories_project_links_org_project_repository_uq" unique ("organization_id", "project_id", "repository_id");`);
  }

}
