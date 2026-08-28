import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** prd/10 §3 — the cost ledger. One row per completed model call. */
@Entity("model_call")
@Index(["tenantId", "createdAt"])
@Index(["runId"])
@Index(["model", "createdAt"])
export class ModelCallEntity {
  @PrimaryGeneratedColumn("increment")
  id!: string;

  @Column("uuid")
  tenantId!: string;

  @Column({ type: "uuid", nullable: true })
  projectId!: string | null;

  @Column({ type: "uuid", nullable: true })
  runId!: string | null;

  @Column({ type: "text", nullable: true })
  runStepId!: string | null;

  @Column({ type: "varchar", nullable: true })
  agentRole!: string | null;

  @Column({ type: "varchar" })
  purpose!: string;

  @Column({ type: "varchar" })
  provider!: string;

  @Column({ type: "varchar" })
  model!: string;

  @Column({ type: "int", default: 0 })
  inputTokens!: number;

  @Column({ type: "int", default: 0 })
  outputTokens!: number;

  @Column({ type: "int", default: 0 })
  cachedInputTokens!: number;

  @Column({ type: "numeric", precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @Column({ type: "int", default: 0 })
  latencyMs!: number;

  @Column({ type: "varchar", default: "none" })
  cacheHit!: "none" | "exact" | "semantic";

  @Column({ type: "jsonb", default: [] })
  routeAttempts!: unknown[];

  @Column({ type: "varchar", nullable: true })
  finishReason!: string | null;

  @Column({ type: "int", default: 0 })
  redactedSpans!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
