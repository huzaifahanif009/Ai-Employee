import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist each run's plan (agent-produced, human-editable). Expand-only. */
export class RunPlan1725700000000 implements MigrationInterface {
  name = 'RunPlan1725700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "run" ADD COLUMN "plan" jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "run" DROP COLUMN IF EXISTS "plan"`);
  }
}
