import { scrubKey } from "./ai-registry.service";

describe("scrubKey", () => {
  it("removes the exact key", () => {
    const key = "sk-proj-ABCDEFG1234567890xyz";
    expect(scrubKey(`Incorrect API key provided: ${key}. Check it.`, key)).not.toContain(key);
  });

  it("removes a partial echo (head + suffix)", () => {
    const key = "sk-proj-ABCDEFG1234567890xyz";
    const echoed = "Incorrect API key provided: sk-proj-***************xyz.";
    expect(scrubKey(echoed, key)).toContain("[redacted]");
    expect(scrubKey(echoed, key)).not.toContain("sk-proj-");
  });

  it("catches any sk- / AIza / gh token pattern even without the exact key", () => {
    expect(scrubKey("saw sk-abcdef123456 in the wild", "unrelated")).toBe("saw [redacted] in the wild");
    expect(scrubKey("token AIzaSyABCDEFGHIJ0123", "x")).toBe("token [redacted]");
    expect(scrubKey("ghp_abcdefghijklmnop", "x")).toBe("[redacted]");
  });

  it("leaves clean text alone", () => {
    expect(scrubKey("42 models visible", "sk-whatever")).toBe("42 models visible");
  });
});
