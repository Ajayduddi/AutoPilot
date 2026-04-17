/**
 * @fileoverview util/request-ip.
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
import type { Request } from "express";

/**
 * Resolves the client IP from Express request state.
 *
 * @remarks
 * This intentionally avoids trusting `X-Forwarded-For` directly. If a deployment
 * sits behind a trusted proxy, configure `app.set("trust proxy", ...)` so
 * Express can safely populate `req.ip`.
 */
export function resolveRequestIp(req: Request): string {
  const forwarded = typeof req.ip === "string" ? req.ip.trim() : "";
  if (forwarded) return forwarded;
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Returns whether the resolved request IP is loopback/local-only.
 */
export function isLoopbackRequest(req: Request): boolean {
  const ip = resolveRequestIp(req);
  return ip === "127.0.0.1"
    || ip === "::1"
    || ip === "::ffff:127.0.0.1";
}
