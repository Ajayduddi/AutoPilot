/**
 * @fileoverview apps/backend/src/util/provider-key-crypto.ts
 *
 * High-level purpose:
 * Shared backend utilities for operational concerns and low-level helpers.
 *
 * Key Features (and trade-offs):
 * - Encapsulates reusable helper logic for runtime infrastructure.
 * - Supports observability, networking, and internal mechanics.
 * - Avoids duplication of common platform helper behavior.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Use utility helpers where cross-domain reuse is needed.
 * 3. Keep helpers side-effect-light and composable.
 * 4. Verify callers after utility contract changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { base64UrlToBytes, bytesToBase64Url } from "./byte-utils";
import { getRuntimeConfig } from "../config/runtime.config";

const PROVIDER_KEY_PREFIX = 'enc:v1:';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let importedProviderKeyPromise: Promise<CryptoKey | null> | null = null;

function getProviderKeyEncryptionSecret(): string {
  return getRuntimeConfig().providerKeyCrypto.encryptionKey || '';
}

async function getProviderKey(): Promise<CryptoKey | null> {
  if (importedProviderKeyPromise) return importedProviderKeyPromise;
  importedProviderKeyPromise = (async () => {
    const secret = getProviderKeyEncryptionSecret();
    if (!secret.trim()) return null;
    const rawKey = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
    return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
  })();
  return importedProviderKeyPromise;
}

export function isEncryptedProviderApiKey(stored?: string | null): boolean {
  return Boolean(stored && stored.startsWith(PROVIDER_KEY_PREFIX));
}

export async function encryptProviderApiKey(plain?: string | null): Promise<string | null> {
  if (!plain) return null;
  const key = await getProviderKey();
  if (!key) {
    throw new Error('PROVIDER_API_KEY_ENCRYPTION_KEY is required to store provider API keys securely.');
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plain),
  );

  const encryptedBytes = new Uint8Array(encrypted);
  const authTag = encryptedBytes.slice(encryptedBytes.length - 16);
  const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - 16);
  return `${PROVIDER_KEY_PREFIX}${bytesToBase64Url(iv)}:${bytesToBase64Url(ciphertext)}:${bytesToBase64Url(authTag)}`;
}

export async function decryptProviderApiKey(stored?: string | null): Promise<string | null> {
  if (!stored) return null;
  if (!stored.startsWith(PROVIDER_KEY_PREFIX)) return stored;

  const key = await getProviderKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Encrypted provider API keys cannot be decrypted because PROVIDER_API_KEY_ENCRYPTION_KEY is missing.');
    }
    return null;
  }

  const raw = stored.slice(PROVIDER_KEY_PREFIX.length);
  const [ivB64, dataB64, tagB64] = raw.split(':');
  if (!ivB64 || !dataB64 || !tagB64) return null;

  try {
    const iv = base64UrlToBytes(ivB64);
    const data = base64UrlToBytes(dataB64);
    const tag = base64UrlToBytes(tagB64);
    const payload = new Uint8Array(data.length + tag.length);
    payload.set(data, 0);
    payload.set(tag, data.length);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      payload as unknown as BufferSource,
    );
    return decoder.decode(decrypted);
  } catch {
    return null;
  }
}

export function resetProviderKeyCryptoForTests() {
  importedProviderKeyPromise = null;
}
