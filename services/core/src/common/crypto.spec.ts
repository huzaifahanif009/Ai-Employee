import { decryptSecret, deriveKey, encryptSecret, secretHint } from "./crypto";

describe("connector-secret crypto", () => {
  const key = deriveKey("", "jwt-secret-for-tests");

  it("round-trips a token", () => {
    const token = "glpat-abcdefghijklmnop1234";
    const ct = encryptSecret(token, key);
    expect(ct.startsWith("aesgcm.v1.")).toBe(true);
    expect(ct).not.toContain(token);
    expect(decryptSecret(ct, key)).toBe(token);
  });

  it("fails to decrypt with the wrong key", () => {
    const ct = encryptSecret("secret", key);
    const wrong = deriveKey("", "different-jwt-secret");
    expect(() => decryptSecret(ct, wrong)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const ct = encryptSecret("secret", key);
    const tampered = ct.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("uses an explicit 32-byte base64 key when provided", () => {
    const explicit = Buffer.alloc(32, 7).toString("base64");
    const k = deriveKey(explicit, "ignored");
    expect(k.equals(Buffer.alloc(32, 7))).toBe(true);
  });

  it("hints without revealing", () => {
    expect(secretHint("glpat-verylongtoken9999")).toBe("••••9999");
    expect(secretHint("ab")).toBe("••••");
  });
});
