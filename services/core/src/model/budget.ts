/**
 * prd/07 §7 — per-Run budget check. Reserve an estimate before a model call, compare the
 * projected spend against the Run's ceiling, and classify: ok / soft (raise an approval) /
 * hard (abort). Tenant + Project monthly caps are a follow-up.
 */

export interface BudgetLimits {
  usd?: number;
  tokens?: number;
}

export interface BudgetSpent {
  costUsd: number;
  tokens: number;
}

export type BudgetVerdict = "ok" | "soft" | "hard";

export interface BudgetCheck {
  verdict: BudgetVerdict;
  reason?: string;
  projectedUsd: number;
  limitUsd?: number;
}

export const DEFAULT_RUN_USD_LIMIT = 5;
export const DEFAULT_SOFT_PCT = 80;

export function checkBudget(
  limits: BudgetLimits,
  spent: BudgetSpent,
  estimate: { costUsd: number; tokens: number },
  softPct = DEFAULT_SOFT_PCT,
): BudgetCheck {
  const limitUsd = limits.usd ?? DEFAULT_RUN_USD_LIMIT;
  const projectedUsd = +(spent.costUsd + estimate.costUsd).toFixed(6);

  if (projectedUsd >= limitUsd) {
    return {
      verdict: "hard",
      reason: `projected $${projectedUsd.toFixed(4)} ≥ hard limit $${limitUsd}`,
      projectedUsd,
      limitUsd,
    };
  }
  if (limits.tokens && spent.tokens + estimate.tokens >= limits.tokens) {
    return {
      verdict: "hard",
      reason: `projected ${spent.tokens + estimate.tokens} tok ≥ hard limit ${limits.tokens}`,
      projectedUsd,
      limitUsd,
    };
  }
  if (projectedUsd >= (limitUsd * softPct) / 100) {
    return {
      verdict: "soft",
      reason: `projected $${projectedUsd.toFixed(4)} ≥ ${softPct}% of $${limitUsd}`,
      projectedUsd,
      limitUsd,
    };
  }
  return { verdict: "ok", projectedUsd, limitUsd };
}

/** Rough token estimate for cost reservation before a call (≈4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCostUsd(
  inputTokens: number,
  maxOutputTokens: number,
  priceInputPerMTok: number,
  priceOutputPerMTok: number,
): number {
  return +(
    (inputTokens / 1_000_000) * priceInputPerMTok +
    (maxOutputTokens / 1_000_000) * priceOutputPerMTok
  ).toFixed(6);
}
