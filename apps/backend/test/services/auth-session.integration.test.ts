import { describe, expect, it } from "bun:test";
import { AuthService } from "../../src/services/auth.service";

describe("AuthService integration-ish behavior", () => {
  it("hashes and verifies passwords correctly", async () => {
    const hash = await AuthService.hashPassword("very-strong-password");
    const valid = await AuthService.verifyPassword("very-strong-password", hash);
    const invalid = await AuthService.verifyPassword("wrong-password", hash);

    expect(valid).toBe(true);
    expect(invalid).toBe(false);
  });

  it("serializes and parses session cookies safely", () => {
    const cookie = AuthService.serializeSessionCookie("token_123");
    const parsed = AuthService.parseCookies(cookie);
    expect(parsed.ap_session).toBe("token_123");

    const cleared = AuthService.clearSessionCookie();
    expect(cleared).toContain("Max-Age=0");
  });
});

