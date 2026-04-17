/**
 * @fileoverview middleware/rate-limit.middleware.
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
import type { Request, Response, NextFunction } from 'express';
import { resolveRequestIp } from '../util/request-ip';

type RateBucket = {
    count: number;
    resetAt: number;
};

const store = new Map<string, RateBucket>();

function nowMs() {
  return Date.now();
}

function cleanup(maxEntries = 5000) {
  if (store.size <= maxEntries) return;
    const now = nowMs();
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

function clientIp(req: Request) {
  return resolveRequestIp(req);
}

function defaultKeyPart(req: Request) {
    const userId = req.auth?.user?.id;
    const ip = clientIp(req);
  return userId ? `user:${userId}:ip:${ip}` : `ip:${ip}`;
}

/**
 * Creates a keyed rate-limiting middleware with fixed window counters.
 */
export function rateLimit(opts: {
    keyPrefix: string;
    limit: number;
    windowMs: number;
  keyBy?: (req: Request) => string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    cleanup();
        const keyPart = opts.keyBy ? opts.keyBy(req) : defaultKeyPart(req);
        const key = `${opts.keyPrefix}:${keyPart}`;
        const now = nowMs();
        const existing = store.get(key);

    if (!existing || existing.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    if (existing.count >= opts.limit) {
            const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        status: 'error',
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
      });
    }

    existing.count += 1;
    store.set(key, existing);
    return next();
  };
}
