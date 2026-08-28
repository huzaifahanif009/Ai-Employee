import { MigrationInterface, QueryRunner } from 'typeorm';

/** Project → tracker connector link + intake cursor. Expand-only. */
export class Tracker1725400000000 implements MigrationInterface {
  name = 'Tracker1725400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "project" ADD COLUMN "trackerConnectorId" uuid`);
    await q.query(`ALTER TABLE "project" ADD COLUMN "intakeCursor" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "project" DROP COLUMN IF EXISTS "intakeCursor"`);
    await q.query(`ALTER TABLE "project" DROP COLUMN IF EXISTS "trackerConnectorId"`);
  }
}
