import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

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
