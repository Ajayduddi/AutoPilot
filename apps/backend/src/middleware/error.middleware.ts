/**
 * @fileoverview middleware/error.middleware.
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
import { ZodError } from 'zod';
import { logger } from '../util/logger';

/**
 * Handles uncaught route/middleware errors and returns consistent API responses.
 */
export function errorMiddleware(err: Error, req: Request, res: Response, _next: NextFunction) {
  const traceId = req.traceId || 'unknown-trace-id';
  const isDev = process.env.NODE_ENV === 'development';
  logger.error({
    scope: 'error.middleware',
    message: err.message,
    traceId,
    method: req.method,
    url: req.url,
    err,
    ...(isDev && err.stack ? { stack: err.stack } : {}),
  });

  if (err instanceof ZodError || err.name === 'ZodError') {
    return res.status(400).json({
      error: {
        message: 'Validation Error',
        code: 'VALIDATION_ERROR',
      },
      traceId,
      details: (err as ZodError).issues,
    });
  }

  // Generic 500 error for unhandled exceptions
  res.status(500).json({
    error: 'Internal Server Error',
    traceId,
      message: isDev ? err.message : 'An unexpected error occurred'
  });
}
