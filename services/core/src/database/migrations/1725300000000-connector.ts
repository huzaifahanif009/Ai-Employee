import { MigrationInterface, QueryRunner } from 'typeorm';

/** Connectors + project→VCS-connector link. Expand-only. */
export class Connector1725300000000 implements MigrationInterface {
  name = 'Connector1725300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "connector" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "kind" varchar NOT NULL,
        "name" varchar NOT NULL,
        "contracts" jsonb NOT NULL DEFAULT '[]',
        "config" jsonb NOT NULL DEFAULT '{}',
        "authKind" varchar NOT NULL DEFAULT 'token',
        "secretCiphertext" text,
        "secretHint" varchar,
        "status" varchar NOT NULL DEFAULT 'unconfigured',
        "healthDetail" text,
        "lastHealthAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_connector_tenant_kind" ON "connector" ("tenantId","kind")`);
    await q.query(`ALTER TABLE "project" ADD COLUMN "vcsConnectorId" uuid`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "project" DROP COLUMN IF EXISTS "vcsConnectorId"`);
    await q.query(`DROP TABLE IF EXISTS "connector"`);
  }
}
