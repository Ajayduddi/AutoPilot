/**
 * @fileoverview util/network-safety.
 *
 * Outbound URL safety checks for SSRF-resistant network calls.
 */
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Checks whether a hostname is an IPv4 literal.
 *
 * @param hostname - Hostname candidate.
 * @returns `true` when the hostname matches dotted IPv4 format.
 */
function isIpv4(hostname: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

/**
 * Checks whether an IPv4 literal is loopback/private/link-local.
 *
 * @param host - IPv4 literal.
 * @returns `true` when the address belongs to blocked local/private ranges.
 */
function isPrivateOrLocalIpv4(host: string): boolean {
  if (!isIpv4(host)) return false;
  const [a, b] = host.split('.').map((n) => Number(n));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Determines whether a hostname resolves to loopback or private network space.
 *
 * @param hostname - Hostname or IP literal to evaluate.
 * @returns `true` when the host is local/private and should be blocked by default.
 *
 * @remarks
 * The check intentionally covers common RFC1918 IPv4 ranges, link-local ranges,
 * and local suffixes used in development.
 *
 * @example
 * ```typescript
 * isPrivateOrLocalHost("localhost");
 * // true
 *
 * isPrivateOrLocalHost("203.0.113.20");
 * // false
 * ```
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1' || host === '::') return true;

  if (host.startsWith('::ffff:')) {
    const mapped = host.slice('::ffff:'.length);
    return isPrivateOrLocalIpv4(mapped);
  }

  if (isPrivateOrLocalIpv4(host)) return true;

  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  return false;
}

/**
 * Validates an outbound URL against protocol and private-network policies.
 *
 * @param rawUrl - Raw URL provided by caller or user input.
 * @param options - Validation policy overrides.
 * @param options.allowPrivateLocalInDev - Allows private/local targets outside production.
 * @param options.requireHttpsInProd - Enforces HTTPS protocol in production.
 * @returns Parsed URL when the destination passes safety checks.
 * @throws {Error} When the URL is malformed.
 * @throws {Error} When production HTTPS policy is violated.
 * @throws {Error} When destination points to a private/local network disallowed by policy.
 *
 * @example
 * ```typescript
 * const safeUrl = assertSafeOutboundUrl("https://api.example.com/webhook");
 * console.log(safeUrl.hostname);
 * ```
 */
export function assertSafeOutboundUrl(
  rawUrl: string,
  options?: {
    allowPrivateLocalInDev?: boolean;
    requireHttpsInProd?: boolean;
  },
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }

  const requireHttpsInProd = options?.requireHttpsInProd ?? true;
  if (requireHttpsInProd && IS_PROD && parsed.protocol !== 'https:') {
    throw new Error('Only https URLs are allowed in production');
  }

  const allowPrivateLocalInDev = options?.allowPrivateLocalInDev ?? true;
  if (isPrivateOrLocalHost(parsed.hostname)) {
    if (!(allowPrivateLocalInDev && !IS_PROD)) {
      throw new Error('Private/local network targets are blocked by server policy');
    }
  }

  return parsed;
}
