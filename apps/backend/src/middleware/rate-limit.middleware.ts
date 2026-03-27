import type { Request, Response, NextFunction } from 'express';

type RateBucket = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateBucket>();

function nowMs() {
  return Date.now();
}

function cleanup(maxEntries = 5000) {
  if (store.size <= maxEntries) return;
  const now = nowMs();
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

function clientIp(req: Request) {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.trim()) return xfwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function rateLimit(opts: {
  keyPrefix: string;
  limit: number;
  windowMs: number;
  keyBy?: (req: Request) => string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    cleanup();
    const keyPart = opts.keyBy ? opts.keyBy(req) : clientIp(req);
    const key = `${opts.keyPrefix}:${keyPart}`;
    const now = nowMs();
    const existing = store.get(key);

    if (!existing || existing.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    if (existing.count >= opts.limit) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        status: 'error',
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
      });
    }

    existing.count += 1;
    store.set(key, existing);
    return next();
  };
}

