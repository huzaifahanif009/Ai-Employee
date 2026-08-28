import { MigrationInterface, QueryRunner } from 'typeorm';

/** prd/10 §3 — the tool-call log. Expand-only. */
export class ToolCall1725200000000 implements MigrationInterface {
  name = 'ToolCall1725200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "tool_call" (
        "id" bigserial PRIMARY KEY,
        "tenantId" uuid NOT NULL,
        "runId" uuid NOT NULL,
        "runStepId" text,
        "seq" int NOT NULL,
        "toolName" varchar NOT NULL,
        "execution" varchar NOT NULL,
        "riskTier" varchar NOT NULL,
        "input" jsonb NOT NULL DEFAULT '{}',
        "inputHash" text,
        "outputPreview" text NOT NULL DEFAULT '',
        "status" varchar NOT NULL,
        "durationMs" int NOT NULL DEFAULT 0,
        "bytesOut" int NOT NULL DEFAULT 0,
        "error" text,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_tool_call_tenant_run" ON "tool_call" ("tenantId","runId")`);
    await q.query(`CREATE INDEX "ix_tool_call_run_seq" ON "tool_call" ("runId","seq")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "tool_call"`);
  }
}
