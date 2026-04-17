import { describe, expect, it } from "bun:test";
import { buildTotpProvisioningUri, generateTotpSecret, verifyTotpCode } from "../../src/util/totp";

describe("totp utility", () => {
  it("generates base32 secrets", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it("verifies RFC6238-compatible codes", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    await expect(verifyTotpCode({
      secret,
      code: "94287082",
      digits: 8,
      period: 30,
      window: 0,
      nowMs: 59_000,
    })).resolves.toBe(true);
  });

  it("builds otpauth provisioning URIs", () => {
    const uri = buildTotpProvisioningUri({
      issuer: "Autopilot",
      accountName: "user@example.com",
      secret: "JBSWY3DPEHPK3PXP",
    });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("issuer=Autopilot");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
  });
});
