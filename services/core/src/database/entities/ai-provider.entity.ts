import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type AiProviderKind =
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible"
  | "azure-openai";

/** A configured AI provider instance for a tenant (prd/07). Keys + models hang off it. */
@Entity("ai_provider")
@Index(["tenantId", "kind"])
export class AiProviderEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  tenantId!: string;

  @Column({ type: "varchar" })
  kind!: AiProviderKind;

  @Column()
  name!: string;

  /** override endpoint — self-hosted / proxy / Azure resource. Null = adapter default. */
  @Column({ type: "text", nullable: true })
  baseUrl!: string | null;

  /** kind-specific bits: azure { deployment, apiVersion }, etc. */
  @Column({ type: "jsonb", default: {} })
  config!: Record<string, unknown>;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "boolean", default: false })
  isDefault!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
