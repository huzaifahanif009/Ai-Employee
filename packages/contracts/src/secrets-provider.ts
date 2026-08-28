import { HealthStatus, SecretRef } from './common';

/** ADR-0010 / prd/14 §4. Default impl: Infisical; adapter: OpenBao/Vault. */
export interface SecretsProvider {
  readonly id: string;

  /** Fetch a secret value by reference. Every call is audited by the caller (metadata only). */
  read(ref: SecretRef): Promise<string>;

  /** Store/replace a secret; returns the new reference (write-only from the UI's perspective). */
  write(path: string, value: string): Promise<SecretRef>;

  /** Rotate where the backend supports it. */
  rotate?(ref: SecretRef): Promise<SecretRef>;

  /** Delete permanently. */
  destroy(ref: SecretRef): Promise<void>;

  healthCheck(): Promise<HealthStatus>;
}
