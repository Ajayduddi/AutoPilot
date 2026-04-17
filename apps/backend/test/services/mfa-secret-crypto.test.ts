import { afterEach, describe, expect, it } from "bun:test";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  resetMfaSecretCryptoForTests,
} from "../../src/util/mfa-secret-crypto";
import { resetRuntimeConfigCache } from "../../src/config/runtime.config";

const originalKey = process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalKey === undefined) delete process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
  else process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = originalKey;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  resetRuntimeConfigCache();
  resetMfaSecretCryptoForTests();
});

describe("mfa secret crypto", () => {
  it("encrypts and decrypts TOTP secrets", async () => {
    process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = "test-provider-key-32-bytes-minimum";
    resetRuntimeConfigCache();
    resetMfaSecretCryptoForTests();

    const encrypted = await encryptMfaSecret("JBSWY3DPEHPK3PXP");
    expect(encrypted).toStartWith("mfa:v1:");
    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");

    const decrypted = await decryptMfaSecret(encrypted);
    expect(decrypted).toBe("JBSWY3DPEHPK3PXP");
  });
});
