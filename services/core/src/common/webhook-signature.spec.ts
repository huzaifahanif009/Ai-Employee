import { createHmac } from "node:crypto";
import { safeEqual, verifyWebhookSignature, webhookFamilyFor } from "./webhook-signature";

const ghSig = (body: string, secret: string) =>
  "sha256=" + createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex");

describe("safeEqual", () => {
  it("true for equal strings", () => expect(safeEqual("abc", "abc")).toBe(true));
  it("false for different strings of equal length", () => expect(safeEqual("abc", "abd")).toBe(false));
  it("false for different lengths, without throwing", () => expect(safeEqual("abc", "abcd")).toBe(false));
  it("false when one side is empty", () => expect(safeEqual("", "abc")).toBe(false));
});

describe("verifyWebhookSignature — github", () => {
  const secret = "whsec_test_123";
  const body = JSON.stringify({ action: "closed", number: 7 });
  const rawBody = Buffer.from(body, "utf8");

  it("accepts a correct HMAC signature", () => {
    const v = verifyWebhookSignature({
      family: "github",
      secret,
      rawBody,
      headers: { "x-hub-signature-256": ghSig(body, secret) },
    });
    expect(v.ok).toBe(true);
  });

  it("rejects a wrong secret with 401", () => {
    const v = verifyWebhookSignature({
      family: "github",
      secret,
      rawBody,
      headers: { "x-hub-signature-256": ghSig(body, "not-the-secret") },
    });
    expect(v).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a tampered body with 401", () => {
    const v = verifyWebhookSignature({
      family: "github",
      secret,
      rawBody: Buffer.from(body + " ", "utf8"),
      headers: { "x-hub-signature-256": ghSig(body, secret) },
    });
    expect(v).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a missing signature header with 401", () => {
    const v = verifyWebhookSignature({ family: "github", secret, rawBody, headers: {} });
    expect(v).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects when raw body is unavailable with 400", () => {
    const v = verifyWebhookSignature({
      family: "github",
      secret,
      rawBody: undefined,
      headers: { "x-hub-signature-256": ghSig(body, secret) },
    });
    expect(v).toMatchObject({ ok: false, status: 400 });
  });
});

describe("verifyWebhookSignature — gitlab", () => {
  const secret = "gl-shared-token";
  it("accepts a matching X-Gitlab-Token", () => {
    const v = verifyWebhookSignature({
      family: "gitlab",
      secret,
      rawBody: undefined,
      headers: { "x-gitlab-token": secret },
    });
    expect(v.ok).toBe(true);
  });
  it("rejects a wrong token with 401", () => {
    const v = verifyWebhookSignature({
      family: "gitlab",
      secret,
      rawBody: undefined,
      headers: { "x-gitlab-token": "wrong" },
    });
    expect(v).toMatchObject({ ok: false, status: 401 });
  });
  it("rejects a missing token with 401", () => {
    const v = verifyWebhookSignature({ family: "gitlab", secret, rawBody: undefined, headers: {} });
    expect(v).toMatchObject({ ok: false, status: 401 });
  });
});

describe("verifyWebhookSignature — no secret configured", () => {
  it("returns 403 regardless of family", () => {
    expect(verifyWebhookSignature({ family: "github", secret: "", rawBody: Buffer.from("{}"), headers: {} }))
      .toMatchObject({ ok: false, status: 403 });
    expect(verifyWebhookSignature({ family: "gitlab", secret: "", rawBody: undefined, headers: {} }))
      .toMatchObject({ ok: false, status: 403 });
  });
});

describe("webhookFamilyFor", () => {
  it("maps known kinds", () => {
    expect(webhookFamilyFor("github")).toBe("github");
    expect(webhookFamilyFor("gitlab")).toBe("gitlab");
    expect(webhookFamilyFor("bitbucket")).toBeNull();
  });
});
