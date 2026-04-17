/**
 * @fileoverview middleware/csrf.middleware.
 *
 * High-level purpose:
 * Cross-cutting HTTP middleware for security, validation, tracing, and request policy enforcement.
 *
 * Key Features (and trade-offs):
 * - Composes request guards before handlers execute.
 * - Standardizes auth, CSRF, headers, and error boundaries.
 * - Provides reusable policy units across API routes.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Mount middleware in bootstrap with explicit ordering.
 * 3. Keep middleware focused on request/response concerns.
 * 4. Regression-test security-sensitive changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import type { NextFunction, Request, Response } from "express";

const CSRF_COOKIE_NAME = "ap_csrf";
const IS_PROD = process.env.NODE_ENV === "production";
const encoder = new TextEncoder();

/**
 * Decodes cookie values without throwing on malformed percent-encoding.
 *
 * @param value - Raw cookie value segment.
 * @returns Decoded value when valid percent-encoding is present, else the original value.
 */
function safeDecodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parses the `Cookie` header into a key/value map.
 *
 * @param cookieHeader - Raw `Cookie` header value.
 * @returns Cookie map keyed by cookie name.
 */
function parseCookies(cookieHeader?: string | null): Record<string, string> {
    const out: Record<string, string> = {};
  if (!cookieHeader) return out;
    const parts = cookieHeader.split(";");
  for (const raw of parts) {
    const [k, ...rest] = raw.trim().split("=");
    if (!k) continue;
    out[k] = safeDecodeCookieValue(rest.join("=") || "");
  }
  return out;
}

/**
 * Compares two strings in constant time when lengths match.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns `true` when values are equal.
 */
function constantEquals(left: string, right: string): boolean {
    const a = encoder.encode(left);
    const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Appends the CSRF cookie to the response.
 *
 * @param res - Express response.
 * @param value - CSRF token to issue.
 */
function issueCsrfCookie(res: Response, value: string): void {
    const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
  ];
  if (IS_PROD) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/**
 * Checks whether an HTTP method mutates server state.
 *
 * @param method - HTTP method string.
 * @returns `true` for `POST`, `PUT`, `PATCH`, and `DELETE`.
 */
function isMutationMethod(method: string): boolean {
    const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

/**
 * Enforces CSRF protection for authenticated mutation requests.
 *
 * @param req - Incoming Express request.
 * @param res - Express response used for issuing cookie and forbidden responses.
 * @param next - Continuation callback in the middleware chain.
 * @returns Calls `next()` when request is allowed, or returns a `403` JSON error.
 *
 * @remarks
 * A CSRF cookie is always issued when missing. Validation is only applied to
 * mutation methods (`POST`, `PUT`, `PATCH`, `DELETE`) for authenticated users.
 *
 * @example
 * ```typescript
 * app.use(csrfMiddleware);
 * ```
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
    const cookies = parseCookies(req.headers.cookie);
    let csrfToken = cookies[CSRF_COOKIE_NAME];
  if (!csrfToken) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    csrfToken = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    issueCsrfCookie(res, csrfToken);
  }

  if (!isMutationMethod(req.method)) return next();
  if (!req.auth?.user) return next();

    const headerToken = (() => {
        const raw = req.headers["x-csrf-token"];
    if (Array.isArray(raw)) return raw[0] || "";
    return raw || "";
  })();

  if (!headerToken || !constantEquals(headerToken, csrfToken)) {
    return res.status(403).json({
      status: "error",
      error: { code: "CSRF_INVALID", message: "Missing or invalid CSRF token." },
    });
  }

  return next();
}
