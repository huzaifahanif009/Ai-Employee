import { MigrationInterface, QueryRunner } from 'typeorm';

/** DB-backed AI providers / keys / models (prd/07). Expand-only. */
export class AiProviders1725500000000 implements MigrationInterface {
  name = 'AiProviders1725500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "ai_provider" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "kind" varchar NOT NULL,
        "name" varchar NOT NULL,
        "baseUrl" text,
        "config" jsonb NOT NULL DEFAULT '{}',
        "enabled" boolean NOT NULL DEFAULT true,
        "isDefault" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_ai_provider_tenant_kind" ON "ai_provider" ("tenantId","kind")`);

    await q.query(`
      CREATE TABLE "ai_provider_key" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "providerId" uuid NOT NULL,
        "label" varchar NOT NULL,
        "secretCiphertext" text NOT NULL,
        "last4" varchar NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "isDefault" boolean NOT NULL DEFAULT false,
        "status" varchar NOT NULL DEFAULT 'untested',
        "lastTestDetail" text,
        "lastTestedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_ai_provider_key_tenant_provider" ON "ai_provider_key" ("tenantId","providerId")`);

    await q.query(`
      CREATE TABLE "ai_model" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "providerId" uuid NOT NULL,
        "alias" varchar NOT NULL,
        "providerModel" varchar NOT NULL,
        "routingClasses" jsonb NOT NULL DEFAULT '[]',
        "capabilities" jsonb NOT NULL DEFAULT '[]',
        "contextWindow" int NOT NULL DEFAULT 128000,
        "maxOutput" int NOT NULL DEFAULT 8000,
        "priceInputPerMTok" numeric(10,4) NOT NULL DEFAULT 0,
        "priceOutputPerMTok" numeric(10,4) NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "isDefault" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX "ux_ai_model_tenant_alias" ON "ai_model" ("tenantId","alias")`);
    await q.query(`CREATE INDEX "ix_ai_model_tenant_provider" ON "ai_model" ("tenantId","providerId")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_model"`);
    await q.query(`DROP TABLE IF EXISTS "ai_provider_key"`);
    await q.query(`DROP TABLE IF EXISTS "ai_provider"`);
  }
}
