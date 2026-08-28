import { checkBudget, estimateCostUsd, estimateTokens } from "./budget";

describe("budget check", () => {
  const spent = { costUsd: 0, tokens: 0 };

  it("passes when well under the limit", () => {
    const r = checkBudget({ usd: 5 }, spent, { costUsd: 0.5, tokens: 1000 });
    expect(r.verdict).toBe("ok");
  });

  it("raises soft at the configured percentage", () => {
    const r = checkBudget({ usd: 5 }, { costUsd: 3.9, tokens: 0 }, { costUsd: 0.2, tokens: 0 });
    expect(r.verdict).toBe("soft");
  });

  it("aborts hard at/over the ceiling", () => {
    const r = checkBudget({ usd: 5 }, { costUsd: 4.8, tokens: 0 }, { costUsd: 0.3, tokens: 0 });
    expect(r.verdict).toBe("hard");
  });

  it("hard-stops on a token ceiling", () => {
    const r = checkBudget({ usd: 100, tokens: 10_000 }, { costUsd: 0, tokens: 9_500 }, { costUsd: 0.01, tokens: 600 });
    expect(r.verdict).toBe("hard");
  });

  it("uses the default USD limit when none is set", () => {
    const r = checkBudget({}, { costUsd: 4.9, tokens: 0 }, { costUsd: 0.2, tokens: 0 });
    expect(r.limitUsd).toBe(5);
    expect(r.verdict).toBe("hard");
  });

  it("estimates tokens and cost sanely", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateCostUsd(1_000_000, 0, 3, 15)).toBe(3);
  });
});
