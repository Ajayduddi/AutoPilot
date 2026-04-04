/**
 * @fileoverview middleware/trace.middleware.
 *
 * Request trace ID assignment and propagation middleware.
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

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
