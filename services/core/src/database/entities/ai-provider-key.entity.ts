import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type KeyStatus = "untested" | "valid" | "invalid" | "error";

/** One API key for a provider. Multiple per provider (rotation, per-env, per-team). */
@Entity("ai_provider_key")
@Index(["tenantId", "providerId"])
export class AiProviderKeyEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  tenantId!: string;

  @Column("uuid")
  providerId!: string;

  @Column()
  label!: string;

  /** AES-256-GCM ciphertext (common/crypto.ts). Never returned by any endpoint, never logged. */
  @Column({ type: "text" })
  secretCiphertext!: string;

  /** last 4 chars, for the UI */
  @Column({ type: "varchar" })
  last4!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "varchar", default: "untested" })
  status!: KeyStatus;

  @Column({ type: "text", nullable: true })
  lastTestDetail!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  lastTestedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
