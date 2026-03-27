import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { WebhookSecretRepo } from '../repositories/webhook-secret.repo';

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isWebhookSecretsTableMissing(err: unknown): boolean {
  const message = (err as { message?: string })?.message || '';
  return message.includes('webhook_secrets');
}

export const requireWebhookSecret = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const envSecret = process.env.WEBHOOK_CALLBACK_SECRET || process.env.N8N_CALLBACK_SECRET;
    const providedSecret = getHeaderValue(req.headers['x-webhook-secret']) || getHeaderValue(req.headers['x-n8n-secret']);
    let dbSecretsReady = true;

    if (providedSecret) {
      try {
        const matchedDbSecret = await WebhookSecretRepo.findActiveSecretByPlaintext(providedSecret);
        if (matchedDbSecret) {
          await WebhookSecretRepo.markUsed(matchedDbSecret.id);
          return next();
        }
      } catch (err) {
        if (!isWebhookSecretsTableMissing(err)) throw err;
        dbSecretsReady = false;
        console.warn('[SECURITY] webhook_secrets table not found. Falling back to env-based secret validation.');
      }

      if (envSecret && secureEqual(providedSecret, envSecret)) {
        return next();
      }

      return res.status(401).json({ error: 'Unauthorized webhook call' });
    }

    let hasActiveDbSecrets = false;
    if (dbSecretsReady) {
      try {
        hasActiveDbSecrets = await WebhookSecretRepo.hasActiveSecrets();
      } catch (err) {
        if (!isWebhookSecretsTableMissing(err)) throw err;
        dbSecretsReady = false;
        console.warn('[SECURITY] webhook_secrets table not found. Falling back to env-based secret validation.');
      }
    }

    if (hasActiveDbSecrets || envSecret) {
      return res.status(401).json({ error: 'Missing webhook secret header' });
    }

    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        error: 'Webhook security is not configured. Configure webhook secrets before enabling callbacks in production.',
      });
    }

    if (!dbSecretsReady) {
      console.warn('[SECURITY] No webhook secret configured and webhook_secrets table is unavailable. Development fallback allows unsecured callbacks.');
    } else {
      console.warn('[SECURITY] No webhook secret configured. Development fallback allows unsecured callbacks.');
    }
    return next();
  } catch (err) {
    return next(err);
  }
};
