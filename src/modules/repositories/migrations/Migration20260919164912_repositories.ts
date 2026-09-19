import { Migration } from '@mikro-orm/migrations';

export class Migration20260919164912_repositories extends Migration {

  override name = 'Migration20260919164912';

  override up(): void | Promise<void> {
    this.addSql(`create table "repositories_project_links" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "repository_id" uuid not null, "is_default" boolean not null default false, "created_by" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "repositories_project_links_scope_project_idx" on "repositories_project_links" ("tenant_id", "organization_id", "project_id");`);
    this.addSql(`create unique index "repositories_project_links_org_project_default_uq" on "repositories_project_links" ("organization_id", "project_id") where "is_default" is true;`);
    this.addSql(`alter table "repositories_project_links" add constraint "repositories_project_links_org_project_repository_uq" unique ("organization_id", "project_id", "repository_id");`);
  }

}
