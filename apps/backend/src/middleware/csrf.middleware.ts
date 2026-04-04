/**
 * @fileoverview middleware/csrf.middleware.
 *
 * Cross-cutting HTTP middleware for security, auth, tracing, and input handling.
 */
import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";

const CSRF_COOKIE_NAME = "ap_csrf";
const IS_PROD = process.env.NODE_ENV === "production";

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
    const a = Buffer.from(left);
    const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
    csrfToken = crypto.randomBytes(24).toString("base64url");
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

