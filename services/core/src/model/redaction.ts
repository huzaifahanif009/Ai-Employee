/**
 * prd/07 §8 / prd/14 §9 — strip secret-shaped strings from a prompt before it leaves the
 * Model Router, and from anything persisted (ledger, logs). Not a substitute for "no secrets
 * in agent context" (that's enforced upstream), a defence-in-depth backstop.
 */

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /AKIA[0-9A-Z]{16}/g, label: "AWS_ACCESS_KEY_ID" },
  { re: /\bASIA[0-9A-Z]{16}\b/g, label: "AWS_STS_KEY" },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, label: "API_KEY" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, label: "GITHUB_TOKEN" },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, label: "GITLAB_TOKEN" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: "SLACK_TOKEN" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: "PRIVATE_KEY" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: "JWT" },
  { re: /(?<=Authorization:\s*Bearer\s)[A-Za-z0-9._-]{16,}/gi, label: "BEARER" },
];

export interface RedactionResult {
  text: string;
  redacted: number;
}

export function redactText(input: string, extraSecrets: string[] = []): RedactionResult {
  let text = input;
  let redacted = 0;

  for (const secret of extraSecrets) {
    if (!secret || secret.length < 8) continue;
    const re = new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    text = text.replace(re, () => {
      redacted++;
      return "[REDACTED]";
    });
  }

  for (const { re, label } of PATTERNS) {
    text = text.replace(re, () => {
      redacted++;
      return `[REDACTED:${label}]`;
    });
  }

  // high-entropy standalone blobs (long, mixed-charset, no spaces) — catch-all
  text = text.replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, (m) => {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((r) => r.test(m)).length;
    if (classes >= 3) {
      redacted++;
      return "[REDACTED:HIGH_ENTROPY]";
    }
    return m;
  });

  return { text, redacted };
}

export function redactMessages<T extends { content: unknown }>(
  messages: T[],
  extraSecrets: string[] = [],
): { messages: T[]; redacted: number } {
  let total = 0;
  const out = messages.map((m) => {
    if (typeof m.content === "string") {
      const r = redactText(m.content, extraSecrets);
      total += r.redacted;
      return { ...m, content: r.text };
    }
    if (Array.isArray(m.content)) {
      const content = m.content.map((part: unknown) => {
        if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
          const r = redactText((part as { text: string }).text, extraSecrets);
          total += r.redacted;
          return { ...(part as object), text: r.text };
        }
        return part;
      });
      return { ...m, content };
    }
    return m;
  });
  return { messages: out, redacted: total };
}
