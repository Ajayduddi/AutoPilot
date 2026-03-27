import { NextFunction, Request, Response } from 'express';
import { AuthService, toSafeUser } from '../services/auth.service';

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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}
