/**
 * @fileoverview types/express-auth.d.
 *
 * Type augmentation and ambient declarations used by backend runtime modules.
 */
import 'express';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: {
          id: string;
          email: string;
          name: string | null;
          timezone?: string | null;
        };
      };
    }
  }
}

export {};
