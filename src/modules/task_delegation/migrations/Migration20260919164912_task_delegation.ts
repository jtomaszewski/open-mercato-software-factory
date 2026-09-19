import { Migration } from '@mikro-orm/migrations';

export class Migration20260919164912_task_delegation extends Migration {

  override name = 'Migration20260919164912';

  override up(): void | Promise<void> {
    this.addSql(`alter table "task_delegations" add "repository_id" uuid null, add "repository_config_epoch" int null, add "repository_profile_digest" varchar(64) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "task_delegations" drop column "repository_id", drop column "repository_config_epoch", drop column "repository_profile_digest";`);
  }

}
