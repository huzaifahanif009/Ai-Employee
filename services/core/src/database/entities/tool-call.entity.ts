import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** prd/10 §3 — one row per Tool Broker dispatch. */
@Entity("tool_call")
@Index(["tenantId", "runId"])
@Index(["runId", "seq"])
export class ToolCallEntity {
  @PrimaryGeneratedColumn("increment")
  id!: string;

  @Column("uuid")
  tenantId!: string;

  @Column("uuid")
  runId!: string;

  @Column({ type: "text", nullable: true })
  runStepId!: string | null;

  @Column({ type: "int" })
  seq!: number;

  @Column({ type: "varchar" })
  toolName!: string;

  @Column({ type: "varchar" })
  execution!: "sandbox" | "control-plane";

  @Column({ type: "varchar" })
  riskTier!: "auto" | "notify" | "approve" | "forbidden";

  @Column({ type: "jsonb", default: {} })
  input!: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  inputHash!: string | null;

  @Column({ type: "text", default: "" })
  outputPreview!: string;

  @Column({ type: "varchar" })
  status!: "ok" | "error" | "denied" | "needs_approval";

  @Column({ type: "int", default: 0 })
  durationMs!: number;

  @Column({ type: "int", default: 0 })
  bytesOut!: number;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
