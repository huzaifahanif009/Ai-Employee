import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type ConnectorKind = "gitlab" | "github" | "bitbucket" | "generic-git";
export type ContractKind = "vcs" | "tracker" | "chatops" | "ci" | "kv" | "mcp";
export type ConnectorStatus = "healthy" | "degraded" | "down" | "unconfigured";

@Entity("connector")
@Index(["tenantId", "kind"])
export class ConnectorEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  tenantId!: string;

  @Column({ type: "varchar" })
  kind!: ConnectorKind;

  @Column()
  name!: string;

  @Column({ type: "jsonb", default: [] })
  contracts!: ContractKind[];

  /** non-secret config: baseUrl, apiVersion, default project path, etc. */
  @Column({ type: "jsonb", default: {} })
  config!: Record<string, unknown>;

  @Column({ type: "varchar", default: "token" })
  authKind!: "token" | "oauth2" | "app" | "basic" | "ssh-key" | "none";

  /** AES-GCM ciphertext of the token/secret (common/crypto.ts). Never returned by the API. */
  @Column({ type: "text", nullable: true })
  secretCiphertext!: string | null;

  /** last 4 chars of the secret, for the UI */
  @Column({ type: "varchar", nullable: true })
  secretHint!: string | null;

  /** AES-GCM ciphertext of the inbound-webhook secret (GitHub HMAC key / GitLab token). Never returned. */
  @Column({ type: "text", nullable: true })
  webhookSecretCiphertext!: string | null;

  /** last 4 chars of the webhook secret, for the UI */
  @Column({ type: "varchar", nullable: true })
  webhookSecretHint!: string | null;

  @Column({ type: "varchar", default: "unconfigured" })
  status!: ConnectorStatus;

  @Column({ type: "text", nullable: true })
  healthDetail!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  lastHealthAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
