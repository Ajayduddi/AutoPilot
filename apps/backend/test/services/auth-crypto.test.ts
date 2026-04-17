import { describe, expect, it } from "bun:test";
import {
  hashPasswordScrypt,
  randomToken,
  sha256Base64Url,
  sha256HexSync,
  verifyPasswordScrypt,
} from "../../src/util/auth-crypto";

describe("auth-crypto helpers", () => {
  it("generates URL-safe random tokens", () => {
    const token = randomToken(24);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(20);
  });

  it("hashes text consistently", async () => {
    expect(sha256HexSync("autopilot")).toBe(sha256HexSync("autopilot"));
    expect(await sha256Base64Url("autopilot")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("preserves the existing scrypt password contract", async () => {
    const passwordHash = await hashPasswordScrypt("very-strong-password");
    expect(passwordHash.split(":")).toHaveLength(2);
    expect(await verifyPasswordScrypt("very-strong-password", passwordHash)).toBe(true);
    expect(await verifyPasswordScrypt("wrong-password", passwordHash)).toBe(false);
  });
});
