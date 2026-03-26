import { Request, Response, NextFunction } from 'express';

export const requireWebhookSecret = (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.N8N_CALLBACK_SECRET;
  
  if (!secret) {
    console.warn('[SECURITY] N8N_CALLBACK_SECRET is missing from env. Webhooks are unprotected in development.');
    return next();
  }

  const providedSecret = req.headers['x-n8n-secret'];
  if (providedSecret !== secret) {
    return res.status(401).json({ error: 'Unauthorized webhook call' });
  }

  next();
};
