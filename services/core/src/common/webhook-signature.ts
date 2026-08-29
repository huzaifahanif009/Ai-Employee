import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound-webhook authentication (prd/09 §5, prd/14 §7).
 *
 * GitHub signs the raw request body: `X-Hub-Signature-256: sha256=<hex hmac>`,
 * HMAC-SHA256 keyed by the webhook secret. GitLab sends the shared secret
 * verbatim in `X-Gitlab-Token`. Both comparisons are constant-time.
 *
 * These helpers are pure — no DB, no framework — so they unit-test cleanly.
 */

/** length-safe constant-time string compare (never throws, never short-circuits on length) */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // compare against a fixed-size digest so length itself doesn't leak via timing
  const ha = createHmac("sha256", "praxis:webhook:cmp").update(ab).digest();
  const hb = createHmac("sha256", "praxis:webhook:cmp").update(bb).digest();
  return timingSafeEqual(ha, hb) && ab.length === bb.length;
}

export type WebhookFamily = "github" | "gitlab";

export interface VerifyInput {
  family: WebhookFamily;
  secret: string;
  rawBody: Buffer | undefined;
  headers: Record<string, string | undefined>;
}

export interface VerifyVerdict {
  ok: boolean;
  /** HTTP status to return when `ok` is false */
  status?: number;
  reason?: string;
}

const OK: VerifyVerdict = { ok: true };

export function verifyWebhookSignature(input: VerifyInput): VerifyVerdict {
  const { family, secret, rawBody, headers } = input;
  if (!secret) {
    return { ok: false, status: 403, reason: "webhook secret not configured for this connector" };
  }

  if (family === "github") {
    const header = headers["x-hub-signature-256"];
    if (!header) return { ok: false, status: 401, reason: "missing X-Hub-Signature-256" };
    if (!rawBody || rawBody.length === 0) {
      return { ok: false, status: 400, reason: "raw body unavailable for signature check" };
    }
    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEqual(header, expected) ? OK : { ok: false, status: 401, reason: "signature mismatch" };
  }

  // gitlab
  const token = headers["x-gitlab-token"];
  if (!token) return { ok: false, status: 401, reason: "missing X-Gitlab-Token" };
  return safeEqual(token, secret) ? OK : { ok: false, status: 401, reason: "token mismatch" };
}

/** Which webhook family a connector kind speaks. */
export function webhookFamilyFor(kind: string): WebhookFamily | null {
  if (kind === "github") return "github";
  if (kind === "gitlab") return "gitlab";
  return null;
}
