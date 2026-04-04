/**
 * @fileoverview middleware/auth.middleware.
 *
 * Cross-cutting HTTP middleware for security, auth, tracing, and input handling.
 */
import { NextFunction, Request, Response } from 'express';
import { AuthService, toSafeUser } from '../services/auth.service';

/**
 * Resolves authenticated user context from session cookies.
 *
 * @param req - Express request carrying cookie headers.
 * @param _res - Express response (unused).
 * @param next - Continuation callback for middleware chain.
 * @returns Resolves when user context has been attached or request is passed through.
 *
 * @remarks
 * Attaches `req.auth.user` when a valid session exists; otherwise clears auth context.
 */
export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
        const resolved = await AuthService.getSessionUserFromCookie(req.headers.cookie);
    if (resolved?.user) {
      req.auth = {
        user: toSafeUser(resolved.user),
      };
    } else {
      req.auth = undefined;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Guards routes that require a signed-in user.
 *
 * @param req - Express request expected to contain `req.auth.user`.
 * @param res - Express response used for unauthorized replies.
 * @param next - Continuation callback for middleware chain.
 * @returns `401` response when no user session is present; otherwise continues.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}
