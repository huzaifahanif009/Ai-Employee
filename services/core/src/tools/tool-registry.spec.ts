import { isWriteAllowed, NATIVE_TOOLS, toolByName } from "./tool-registry";

describe("tool registry", () => {
  it("has git.push as forbidden until a VCS connector exists", () => {
    expect(toolByName("git.push")?.riskTier).toBe("forbidden");
  });

  it("marks code.search output as untrusted", () => {
    expect(toolByName("code.search")?.untrustedOutput).toBe(true);
  });

  it("every tool declares a risk tier and execution location", () => {
    for (const t of NATIVE_TOOLS) {
      expect(["auto", "notify", "approve", "forbidden"]).toContain(t.riskTier);
      expect(["sandbox", "control-plane"]).toContain(t.execution);
    }
  });

  describe("fs.write path guard", () => {
    it("allows a normal relative path", () => {
      expect(isWriteAllowed("src/notify.js").ok).toBe(true);
    });
    it("blocks traversal", () => {
      expect(isWriteAllowed("../../etc/passwd").ok).toBe(false);
    });
    it("blocks writes into .git internals", () => {
      expect(isWriteAllowed(".git/config").ok).toBe(false);
      expect(isWriteAllowed("repo/.git/hooks/pre-commit").ok).toBe(false);
    });
    it("blocks CI config without an allowlist", () => {
      expect(isWriteAllowed(".github/workflows/ci.yml").ok).toBe(false);
    });
    it("blocks absolute paths outside the workspace", () => {
      expect(isWriteAllowed("/etc/hosts").ok).toBe(false);
      expect(isWriteAllowed("/workspace/repo/x.js").ok).toBe(true);
    });
  });
});
