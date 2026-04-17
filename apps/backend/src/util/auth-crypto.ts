/**
 * @fileoverview apps/backend/src/util/auth-crypto.ts
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
import { bytesToBase64Url, bytesToHex, constantTimeEqualBytes, hexToBytes } from "./byte-utils";

const encoder = new TextEncoder();

type ScryptCompat = {
  scrypt(
    password: string,
    salt: string,
    keylen: number,
    callback: (error: Error | null, derivedKey: Uint8Array) => void,
  ): void;
};

declare const Bun: {
  CryptoHasher: new (algorithm: "sha256") => {
    update(data: string): { digest(format: "hex"): string };
  };
};

function getScryptCompat(): ScryptCompat {
  return require("crypto") as ScryptCompat;
}

function normalizeBytes(input: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(input.byteLength);
  bytes.set(input);
  return bytes;
}

export function randomToken(bytesLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return bytesToBase64Url(bytes);
}

export function randomHex(bytesLength = 16): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytesLength)));
}

export function sha256HexSync(input: string): string {
  return new Bun.CryptoHasher("sha256").update(String(input || "")).digest("hex");
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(input || "")));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashPasswordScrypt(password: string): Promise<string> {
  const salt = randomHex(16);
  const derived = await deriveScrypt(password, salt, 64);
  return `${salt}:${bytesToHex(derived)}`;
}

export async function verifyPasswordScrypt(password: string, passwordHash?: string | null): Promise<boolean> {
  if (!passwordHash) return false;
  const [salt, storedHex] = passwordHash.split(":");
  if (!salt || !storedHex) return false;

  const stored = hexToBytes(storedHex);
  if (!stored.length) return false;

  const derived = await deriveScrypt(password, salt, stored.length);
  return constantTimeEqualBytes(stored, derived);
}

async function deriveScrypt(password: string, salt: string, keyLength: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    getScryptCompat().scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(normalizeBytes(derivedKey));
    });
  });
}
