/**
 * @fileoverview apps/backend/src/util/byte-utils.ts
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
const encoder = new TextEncoder();

function toBinaryString(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, offset + 0x8000);
    output += String.fromCharCode(...chunk);
  }
  return output;
}

function fromBinaryString(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = String(hex || "").trim();
  if (!normalized || normalized.length % 2 !== 0) {
    return new Uint8Array();
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    const value = Number.parseInt(normalized.slice(index, index + 2), 16);
    if (!Number.isFinite(value)) {
      return new Uint8Array();
    }
    bytes[index / 2] = value;
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(toBinaryString(bytes));
}

export function base64ToBytes(value: string): Uint8Array {
  return fromBinaryString(atob(String(value || "")));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  return base64ToBytes(padded);
}

export function utf8ByteLength(value: string): number {
  return encoder.encode(String(value || "")).byteLength;
}

export function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${String(mimeType || "application/octet-stream")};base64,${bytesToBase64(bytes)}`;
}
