import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/** A model a tenant has made available, tied to a provider. Replaces the static catalog. */
@Entity("ai_model")
@Index(["tenantId", "alias"], { unique: true })
@Index(["tenantId", "providerId"])
export class AiModelEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  tenantId!: string;

  @Column("uuid")
  providerId!: string;

  /** routing alias, unique per tenant — e.g. 'strong', 'fast', 'code', 'long-context' */
  @Column()
  alias!: string;

  /** the provider's own model id — e.g. 'gpt-4o-mini', 'claude-3-5-sonnet-latest' */
  @Column()
  providerModel!: string;

  /** which routing classes this model can serve */
  @Column({ type: "jsonb", default: [] })
  routingClasses!: string[];

  @Column({ type: "jsonb", default: [] })
  capabilities!: string[];

  @Column({ type: "int", default: 128000 })
  contextWindow!: number;

  @Column({ type: "int", default: 8000 })
  maxOutput!: number;

  @Column({ type: "numeric", precision: 10, scale: 4, default: 0 })
  priceInputPerMTok!: string;

  @Column({ type: "numeric", precision: 10, scale: 4, default: 0 })
  priceOutputPerMTok!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "boolean", default: false })
  isDefault!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
