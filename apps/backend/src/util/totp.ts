/**
 * @fileoverview apps/backend/src/util/totp.ts
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
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const encoder = new TextEncoder();

function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32ToBytes(value: string): Uint8Array {
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function normalizeDigits(code: string): string {
  return String(code || "").replace(/\s+/g, "").trim();
}

async function hotp(secretBase32: string, counter: number, digits = 6): Promise<string> {
  const secret = base32ToBytes(secretBase32);
  const key = await crypto.subtle.importKey(
    "raw",
    secret as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counterBytes = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    counterBytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = (
    ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff)
  ) >>> 0;
  return String(binary % (10 ** digits)).padStart(digits, "0");
}

export function generateTotpSecret(): string {
  return bytesToBase32(crypto.getRandomValues(new Uint8Array(20)));
}

export function buildTotpProvisioningUri(args: {
  issuer: string;
  accountName: string;
  secret: string;
  digits?: number;
  period?: number;
}): string {
  const issuer = String(args.issuer || "Autopilot").trim() || "Autopilot";
  const accountName = String(args.accountName || "user").trim() || "user";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const url = new URL(`otpauth://totp/${label}`);
  url.searchParams.set("secret", args.secret);
  url.searchParams.set("issuer", issuer);
  url.searchParams.set("algorithm", "SHA1");
  url.searchParams.set("digits", String(args.digits ?? 6));
  url.searchParams.set("period", String(args.period ?? 30));
  return url.toString();
}

export async function verifyTotpCode(args: {
  secret: string;
  code: string;
  digits?: number;
  period?: number;
  window?: number;
  nowMs?: number;
}): Promise<boolean> {
  const code = normalizeDigits(args.code);
  if (!/^\d{6,8}$/.test(code)) return false;

  const digits = args.digits ?? 6;
  const period = args.period ?? 30;
  const window = Math.max(0, args.window ?? 1);
  const nowMs = args.nowMs ?? Date.now();
  const currentCounter = Math.floor(nowMs / 1000 / period);

  for (let offset = -window; offset <= window; offset += 1) {
    const expected = await hotp(args.secret, currentCounter + offset, digits);
    const left = encoder.encode(expected);
    const right = encoder.encode(code);
    if (left.length !== right.length) continue;
    let diff = 0;
    for (let index = 0; index < left.length; index += 1) {
      diff |= left[index] ^ right[index];
    }
    if (diff === 0) return true;
  }

  return false;
}
