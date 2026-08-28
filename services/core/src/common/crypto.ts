import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM at-rest encryption for connector secrets (prd/14 §4). This is an interim
 * store — a real secrets manager (Infisical / OpenBao) plugs in behind a `SecretsProvider`
 * later. The key is `SECRETS_ENCRYPTION_KEY` (base64, 32 bytes) or, in dev, sha256(JWT_SECRET).
 */
export function deriveKey(secretsEncryptionKey: string, jwtSecret: string): Buffer {
  if (secretsEncryptionKey) {
    const buf = Buffer.from(secretsEncryptionKey, "base64");
    if (buf.length === 32) return buf;
  }
  return createHash("sha256").update(`praxis:secrets:${jwtSecret}`).digest();
}

const PREFIX = "aesgcm.v1.";

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  if (!ciphertext.startsWith(PREFIX)) throw new Error("unrecognised ciphertext format");
  const raw = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Last 4 chars, for showing "which token" without revealing it. */
export function secretHint(plaintext: string): string {
  return plaintext.length <= 4 ? "••••" : `••••${plaintext.slice(-4)}`;
}
