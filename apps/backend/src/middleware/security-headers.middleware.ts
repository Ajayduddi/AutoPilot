/**
 * @fileoverview middleware/security-headers.middleware.
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
import type { Request, Response, NextFunction } from "express";
import { getRuntimeConfig } from "../config/runtime.config";

/**
 * Applies baseline browser security headers and optional cross-origin isolation headers.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  const isProd = process.env.NODE_ENV === "production";
  const connectSrc = isProd
    ? ["'self'"]
    : ["'self'", "http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*", "wss://localhost:*", "wss://127.0.0.1:*"];
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "form-action 'self'",
  ].join("; ");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Content-Security-Policy", csp);
  if (getRuntimeConfig().features.crossOriginIsolation) {
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
}
