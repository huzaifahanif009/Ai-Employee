import { MigrationInterface, QueryRunner } from 'typeorm';

/** prd/10 §3 — the model-call cost ledger. Expand-only. */
export class ModelCall1725100000000 implements MigrationInterface {
  name = 'ModelCall1725100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "model_call" (
        "id" bigserial PRIMARY KEY,
        "tenantId" uuid NOT NULL,
        "projectId" uuid,
        "runId" uuid,
        "runStepId" text,
        "agentRole" varchar,
        "purpose" varchar NOT NULL,
        "provider" varchar NOT NULL,
        "model" varchar NOT NULL,
        "inputTokens" int NOT NULL DEFAULT 0,
        "outputTokens" int NOT NULL DEFAULT 0,
        "cachedInputTokens" int NOT NULL DEFAULT 0,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "latencyMs" int NOT NULL DEFAULT 0,
        "cacheHit" varchar NOT NULL DEFAULT 'none',
        "routeAttempts" jsonb NOT NULL DEFAULT '[]',
        "finishReason" varchar,
        "redactedSpans" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_model_call_tenant_created" ON "model_call" ("tenantId","createdAt")`);
    await q.query(`CREATE INDEX "ix_model_call_run" ON "model_call" ("runId")`);
    await q.query(`CREATE INDEX "ix_model_call_model_created" ON "model_call" ("model","createdAt")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "model_call"`);
  }
}
