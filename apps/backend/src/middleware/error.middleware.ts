/**
 * @fileoverview middleware/error.middleware.
 *
 * Centralized Express error normalization and response handling.
 */
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

/**
 * Handles uncaught route/middleware errors and returns consistent API responses.
 */
export function errorMiddleware(err: Error, req: Request, res: Response, next: NextFunction) {
    const traceId = req.traceId || 'unknown-trace-id';
  
  // Structured logging
  console.error(JSON.stringify({
    level: 'error',
    timestamp: new Date().toISOString(),
    traceId,
    method: req.method,
    url: req.url,
    message: err.message,
    stack: err.stack,
  }));

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation Error',
      traceId,
      details: err.issues
    });
  }

  // Generic 500 error for unhandled exceptions
  res.status(500).json({
    error: 'Internal Server Error',
    traceId,
        message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
}
