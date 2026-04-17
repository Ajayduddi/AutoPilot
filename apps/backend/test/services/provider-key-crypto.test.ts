import { afterEach, describe, expect, it } from 'bun:test';
import {
  decryptProviderApiKey,
  encryptProviderApiKey,
  isEncryptedProviderApiKey,
  resetProviderKeyCryptoForTests,
} from '../../src/util/provider-key-crypto';
import { resetRuntimeConfigCache } from '../../src/config/runtime.config';

const originalKey = process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
  } else {
    process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = originalKey;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  resetRuntimeConfigCache();
  resetProviderKeyCryptoForTests();
});

describe('provider key crypto', () => {
  it('encrypts and decrypts provider API keys with WebCrypto', async () => {
    process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = 'test-provider-key-32-bytes-minimum';
    resetRuntimeConfigCache();
    resetProviderKeyCryptoForTests();

    const encrypted = await encryptProviderApiKey('super-secret-api-key');
    expect(encrypted).toBeTruthy();
    expect(isEncryptedProviderApiKey(encrypted)).toBe(true);
    expect(encrypted).not.toContain('super-secret-api-key');

    const decrypted = await decryptProviderApiKey(encrypted);
    expect(decrypted).toBe('super-secret-api-key');
  });

  it('preserves legacy plaintext fallback rows', async () => {
    process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = 'test-provider-key-32-bytes-minimum';
    resetRuntimeConfigCache();
    resetProviderKeyCryptoForTests();

    const decrypted = await decryptProviderApiKey('legacy-plain-key');
    expect(decrypted).toBe('legacy-plain-key');
    expect(isEncryptedProviderApiKey('legacy-plain-key')).toBe(false);
  });

  it('returns null for malformed encrypted values', async () => {
    process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = 'test-provider-key-32-bytes-minimum';
    resetRuntimeConfigCache();
    resetProviderKeyCryptoForTests();

    const decrypted = await decryptProviderApiKey('enc:v1:not:valid');
    expect(decrypted).toBeNull();
  });

  it('returns null outside production when the encryption key is missing', async () => {
    delete process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'development';
    resetRuntimeConfigCache();
    resetProviderKeyCryptoForTests();

    const decrypted = await decryptProviderApiKey('enc:v1:not:valid:payload');
    expect(decrypted).toBeNull();
  });

  it('throws when encrypting without a configured key', async () => {
    delete process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
    resetRuntimeConfigCache();
    resetProviderKeyCryptoForTests();

    await expect(encryptProviderApiKey('secret')).rejects.toThrow('PROVIDER_API_KEY_ENCRYPTION_KEY');
  });
});
