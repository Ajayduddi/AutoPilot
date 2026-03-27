import 'express';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: {
          id: string;
          email: string;
          name: string | null;
        };
      };
    }
  }
}

export {};
