import { Migration } from '@mikro-orm/migrations';

export class Migration20260919155439_repositories extends Migration {

  override name = 'Migration20260919155439';

  override up(): void | Promise<void> {
    this.addSql(`create table "repositories_repositories" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "connection_id" uuid not null, "github_repository_id" varchar(32) not null, "full_name" varchar(200) not null, "base_branch" varchar(255) not null, "kind" varchar(20) not null, "profile" jsonb not null, "config_epoch" int not null default 1, "qualification_status" varchar(20) not null default 'pending', "qualification_epoch" int null, "qualification_report" jsonb null, "status" varchar(20) not null default 'active', "access_status" varchar(20) not null default 'granted', "qualification_attempt_id" uuid null, "qualification_started_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "repositories_repositories_connection_idx" on "repositories_repositories" ("connection_id");`);
    this.addSql(`create index "repositories_repositories_scope_idx" on "repositories_repositories" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "repositories_repositories_org_github_uq" on "repositories_repositories" ("organization_id", "github_repository_id") where "deleted_at" is null;`);

    this.addSql(`create table "repositories_broker_replays" ("id" uuid not null default gen_random_uuid(), "direction" varchar(20) not null, "request_id" uuid not null, "key_id" varchar(100) not null, "claimed_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "repositories_broker_replays" add constraint "repositories_broker_replays_direction_request_uq" unique ("direction", "request_id");`);

    this.addSql(`create table "repositories_connections" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "provider" varchar(20) not null default 'github', "installation_id" varchar(32) not null, "broker_authorization_id" uuid not null, "account_login" varchar(100) not null, "status" varchar(20) not null default 'active', "connected_by" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "repositories_connections_scope_idx" on "repositories_connections" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "repositories_connections_provider_installation_uq" on "repositories_connections" ("provider", "installation_id") where "deleted_at" is null;`);

    this.addSql(`create table "repositories_connect_states" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "nonce_hash" varchar(64) not null, "expected_installation_id" varchar(32) null, "expires_at" timestamptz not null, "used_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "repositories_connect_states_scope_idx" on "repositories_connect_states" ("tenant_id", "organization_id", "user_id");`);
    this.addSql(`alter table "repositories_connect_states" add constraint "repositories_connect_states_nonce_uq" unique ("nonce_hash");`);

    this.addSql(`create table "repositories_event_intents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "event_id" varchar(100) not null, "payload" jsonb not null, "delivered_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "repositories_event_intents_scope_delivery_idx" on "repositories_event_intents" ("tenant_id", "organization_id", "delivered_at");`);

    this.addSql(`create table "repositories_qualification_dispatches" ("id" uuid not null default gen_random_uuid(), "repository_id" uuid not null, "attempt_id" uuid not null, "epoch" int not null, "status" varchar(20) not null default 'pending', "last_error_code" varchar(80) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "repositories_qualification_dispatches_repository_idx" on "repositories_qualification_dispatches" ("repository_id");`);
    this.addSql(`alter table "repositories_qualification_dispatches" add constraint "repositories_qualification_dispatches_attempt_uq" unique ("attempt_id");`);
  }

}
