import { redactMessages, redactText } from "./redaction";

describe("redaction", () => {
  it("redacts an OpenAI-style key", () => {
    const { text, redacted } = redactText("use sk-abcdef1234567890ABCDEF1234 as the key");
    expect(text).not.toContain("sk-abcdef1234567890ABCDEF1234");
    expect(redacted).toBe(1);
  });

  it("redacts an AWS access key id", () => {
    expect(redactText("AKIAIOSFODNN7EXAMPLE").text).toContain("[REDACTED:AWS_ACCESS_KEY_ID]");
  });

  it("redacts a GitHub token and a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDEF123456";
    const r = redactText(`token ghp_${"a".repeat(36)} and jwt ${jwt}`);
    expect(r.text).toContain("[REDACTED:GITHUB_TOKEN]");
    expect(r.text).toContain("[REDACTED:JWT]");
    expect(r.redacted).toBeGreaterThanOrEqual(2);
  });

  it("redacts a private key block", () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\nhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    expect(redactText(pem).text).toBe("[REDACTED:PRIVATE_KEY]");
  });

  it("redacts a tenant-provided secret value verbatim", () => {
    const { text } = redactText("db password is hunter2-super-secret-value", [
      "hunter2-super-secret-value",
    ]);
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("hunter2-super-secret-value");
  });

  it("leaves ordinary prose untouched", () => {
    const prose = "Add a retry policy to the notification service with exponential backoff.";
    expect(redactText(prose).text).toBe(prose);
  });

  it("redacts across message content parts", () => {
    const { messages, redacted } = redactMessages([
      { role: "user", content: "key: sk-ZZZ1234567890abcdefghijklmnop" },
      { role: "user", content: [{ type: "text", text: "also AKIAIOSFODNN7EXAMPLE" }] },
    ] as { role: string; content: unknown }[]);
    expect(redacted).toBe(2);
    expect(JSON.stringify(messages)).not.toContain("sk-ZZZ1234567890");
    expect(JSON.stringify(messages)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});
