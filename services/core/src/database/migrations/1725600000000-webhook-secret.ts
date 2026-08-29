import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-connector inbound-webhook secret (encrypted at rest). Expand-only. */
export class WebhookSecret1725600000000 implements MigrationInterface {
  name = 'WebhookSecret1725600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "connector" ADD COLUMN "webhookSecretCiphertext" text`);
    await q.query(`ALTER TABLE "connector" ADD COLUMN "webhookSecretHint" varchar`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "connector" DROP COLUMN IF EXISTS "webhookSecretHint"`);
    await q.query(`ALTER TABLE "connector" DROP COLUMN IF EXISTS "webhookSecretCiphertext"`);
  }
}
