/**
 * @fileoverview middleware/webhook.middleware.
 *
 * Secret validation middleware for inbound webhook callbacks.
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { WebhookSecretRepo } from '../repositories/webhook-secret.repo';

/** Returns the first header value from single or multi-value header input. */
function getHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/** Performs timing-safe string equality checks for secret comparison. */
function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Detects missing-table errors for `webhook_secrets` during rollout/migrations. */
function isWebhookSecretsTableMissing(err: unknown): boolean {
  const message = (err as { message?: string })?.message || '';
  return message.includes('webhook_secrets');
}

/**
 * Authenticates inbound webhook callbacks using DB-managed or env-based secrets.
 *
 * @param req - Incoming request expected to carry webhook secret headers.
 * @param res - Express response used for unauthorized or misconfiguration responses.
 * @param next - Continuation callback in the middleware chain.
 * @returns Calls `next()` when secret validation succeeds; otherwise returns `401`/`503`.
 *
 * @remarks
 * Validation preference order:
 * 1. Active secret in `webhook_secrets` table.
 * 2. Environment fallback (`WEBHOOK_CALLBACK_SECRET` or `N8N_CALLBACK_SECRET`).
 * 3. Development-only unsecured fallback when no secret source is configured.
 *
 * @example
 * ```typescript
 * router.post("/webhooks/callback", requireWebhookSecret, callbackHandler);
 * ```
 */
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

      return res.status(401).json({ error: { message: 'Unauthorized webhook call', code: 'UNAUTHORIZED' } });
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
      return res.status(401).json({ error: { message: 'Missing webhook secret header', code: 'UNAUTHORIZED' } });
    }

    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        error: {
          message: 'Webhook security is not configured. Configure webhook secrets before enabling callbacks in production.',
          code: 'SERVICE_UNAVAILABLE',
        },
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
