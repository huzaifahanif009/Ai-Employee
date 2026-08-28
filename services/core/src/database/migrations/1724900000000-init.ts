import { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase 1 initial schema. Expand/contract discipline from here on (prd/10 §6). */
export class Init1724900000000 implements MigrationInterface {
  name = 'Init1724900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await q.query(`
      CREATE TABLE "tenant" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "slug" varchar NOT NULL UNIQUE,
        "plan" varchar NOT NULL DEFAULT 'free',
        "settings" jsonb NOT NULL DEFAULT '{}',
        "retention" jsonb NOT NULL DEFAULT '{}',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE "app_user" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar NOT NULL UNIQUE,
        "name" varchar NOT NULL,
        "passwordHash" text,
        "ssoSubject" text,
        "status" varchar NOT NULL DEFAULT 'active',
        "lastLoginAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE "membership" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "role" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX "ux_membership_tenant_user" ON "membership" ("tenantId","userId")`);

    await q.query(`
      CREATE TABLE "project" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "name" varchar NOT NULL,
        "slug" varchar NOT NULL,
        "repoRef" jsonb,
        "baseBranch" varchar NOT NULL DEFAULT 'main',
        "pathScope" text,
        "verifyPipeline" jsonb NOT NULL DEFAULT '{}',
        "intake" jsonb NOT NULL DEFAULT '{"mode":"manual","labelAllowlist":[]}',
        "branchTemplate" varchar NOT NULL DEFAULT 'praxis/{{tracker-key}}-{{slug}}',
        "policyPreset" varchar NOT NULL DEFAULT 'Balanced',
        "budgets" jsonb NOT NULL DEFAULT '{}',
        "archivedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX "ux_project_tenant_slug" ON "project" ("tenantId","slug")`);

    await q.query(`
      CREATE TABLE "work_item" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "projectId" uuid NOT NULL,
        "sourceConnectorId" varchar NOT NULL DEFAULT 'manual',
        "externalId" varchar NOT NULL,
        "externalUrl" text,
        "title" varchar NOT NULL,
        "bodyMd" text NOT NULL DEFAULT '',
        "acceptanceCriteria" jsonb NOT NULL DEFAULT '[]',
        "labels" jsonb NOT NULL DEFAULT '[]',
        "priority" varchar NOT NULL DEFAULT 'normal',
        "assigneeExt" text,
        "attachments" jsonb NOT NULL DEFAULT '[]',
        "raw" jsonb NOT NULL DEFAULT '{}',
        "state" varchar NOT NULL DEFAULT 'received',
        "triage" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "ux_work_item_dedupe" ON "work_item" ("projectId","sourceConnectorId","externalId")`,
    );

    await q.query(`
      CREATE TABLE "run" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "projectId" uuid NOT NULL,
        "workItemId" uuid NOT NULL,
        "seq" int NOT NULL DEFAULT 1,
        "state" varchar NOT NULL DEFAULT 'queued',
        "failureCategory" varchar,
        "failureMessage" text,
        "branchName" text,
        "baseSha" text,
        "headSha" text,
        "prRef" jsonb,
        "sandboxId" jsonb,
        "budgetSnapshot" jsonb NOT NULL DEFAULT '{}',
        "totals" jsonb NOT NULL DEFAULT '{"tokens":0,"costUsd":0,"toolCalls":0,"filesChanged":0,"wallMs":0}',
        "temporalWorkflowId" text,
        "temporalRunId" text,
        "createdBy" uuid,
        "startedAt" timestamptz,
        "endedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "ix_run_tenant_state" ON "run" ("tenantId","state")`);
    await q.query(`CREATE INDEX "ix_run_project_created" ON "run" ("projectId","createdAt")`);

    await q.query(`
      CREATE TABLE "run_event" (
        "id" bigserial PRIMARY KEY,
        "tenantId" uuid NOT NULL,
        "runId" uuid NOT NULL,
        "seq" int NOT NULL,
        "type" varchar NOT NULL,
        "schemaVersion" int NOT NULL DEFAULT 1,
        "traceId" text,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "actor" jsonb,
        "ts" timestamptz NOT NULL,
        "published" boolean NOT NULL DEFAULT false
      )`);
    await q.query(`CREATE UNIQUE INDEX "ux_run_event_run_seq" ON "run_event" ("runId","seq")`);
    await q.query(`CREATE INDEX "ix_run_event_tenant_ts" ON "run_event" ("tenantId","ts")`);
    await q.query(`CREATE INDEX "ix_run_event_unpublished" ON "run_event" ("id") WHERE "published" = false`);

    await q.query(`
      CREATE TABLE "approval" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "runId" uuid NOT NULL,
        "runStepId" uuid,
        "type" varchar NOT NULL,
        "state" varchar NOT NULL DEFAULT 'open',
        "evidence" jsonb NOT NULL DEFAULT '{}',
        "actionPreview" jsonb NOT NULL DEFAULT '{}',
        "slaAt" timestamptz NOT NULL,
        "requestedAt" timestamptz NOT NULL DEFAULT now(),
        "decidedAt" timestamptz,
        "decidedBy" uuid,
        "decisionNote" text,
        "channel" varchar NOT NULL DEFAULT 'dashboard'
      )`);
    await q.query(`CREATE INDEX "ix_approval_tenant_state" ON "approval" ("tenantId","state")`);
    await q.query(
      `CREATE INDEX "ix_approval_open_sla" ON "approval" ("tenantId","slaAt") WHERE "state" = 'open'`,
    );

    await q.query(`
      CREATE TABLE "audit_log" (
        "id" bigserial PRIMARY KEY,
        "tenantId" uuid NOT NULL,
        "actor" jsonb NOT NULL,
        "action" varchar NOT NULL,
        "target" jsonb NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "ts" timestamptz NOT NULL,
        "prevHash" text,
        "hash" text NOT NULL
      )`);
    await q.query(`CREATE INDEX "ix_audit_tenant_ts" ON "audit_log" ("tenantId","ts")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'audit_log',
      'approval',
      'run_event',
      'run',
      'work_item',
      'project',
      'membership',
      'app_user',
      'tenant',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
