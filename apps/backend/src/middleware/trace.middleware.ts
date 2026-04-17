/**
 * @fileoverview middleware/trace.middleware.
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
import { Request, Response, NextFunction } from 'express';

// Extend Express Request interface to include traceId
declare global {
  namespace Express {
    interface Request {
            traceId: string;
    }
  }
}

/**
 * Ensures every request/response pair carries a stable trace identifier.
 */
export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
    const traceId = (req.headers['x-trace-id'] as string) || crypto.randomUUID();
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);
  next();
}
