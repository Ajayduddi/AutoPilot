/**
 * @fileoverview middleware/webhook.middleware.
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
import { Request, Response, NextFunction } from 'express';
import { WebhookSecretRepo } from '../repositories/webhook-secret.repo';
import { logger } from '../util/logger';
import { isLoopbackRequest } from '../util/request-ip';

const encoder = new TextEncoder();

/** Returns the first header value from single or multi-value header input. */
function getHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/** Performs timing-safe string equality checks for secret comparison. */
function secureEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
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
        logger.warn({
          scope: 'webhook.middleware',
          message: 'webhook_secrets table not found. Falling back to env-based secret validation.',
        });
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
        logger.warn({
          scope: 'webhook.middleware',
          message: 'webhook_secrets table not found. Falling back to env-based secret validation.',
        });
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

    if (!isLoopbackRequest(req)) {
      return res.status(503).json({
        error: {
          message: 'Webhook security is not configured. Configure webhook secrets before accepting non-local callbacks.',
          code: 'SERVICE_UNAVAILABLE',
        },
      });
    }

    if (!dbSecretsReady) {
      logger.warn({
        scope: 'webhook.middleware',
        message: 'No webhook secret configured and webhook_secrets table is unavailable. Loopback-only development fallback allows unsecured callbacks.',
      });
    } else {
      logger.warn({
        scope: 'webhook.middleware',
        message: 'No webhook secret configured. Loopback-only development fallback allows unsecured callbacks.',
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
};
