/**
 * @fileoverview middleware/auth.middleware.
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
import { NextFunction, Request, Response } from 'express';
import { AuthService, toSafeUser } from '../services/auth/auth.service';

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
    if (resolved?.user && !resolved.mfaRequired) {
      req.auth = {
        user: toSafeUser(resolved.user),
        mfaVerified: true,
      };
    } else if (resolved?.user && resolved.mfaRequired) {
      req.auth = {
        user: toSafeUser(resolved.user),
        pendingMfaUser: toSafeUser(resolved.user),
        mfaVerified: false,
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
  if (req.auth.mfaVerified === false) {
    return res.status(401).json({ error: 'MFA verification required' });
  }
  next();
}
