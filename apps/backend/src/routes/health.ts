/**
 * @fileoverview routes/health.
 *
 * High-level purpose:
 * HTTP route surface that validates requests and delegates business logic to services.
 *
 * Key Features (and trade-offs):
 * - Schema-driven request validation and response normalization.
 * - Auth/rate-limit aware route composition for API boundaries.
 * - Thin handlers that preserve routes -> services -> repositories layering.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add new endpoints by pairing route handlers with schemas.
 * 3. Delegate business decisions to service layer components.
 * 4. Verify contract changes with API and route tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getRuntimeConfig } from '../config/runtime.config';
import { WebhookSecretRepo } from '../repositories/webhook-secret.repo';
import { renderPrometheusMetrics } from '../util/metrics';
import { logger } from '../util/logger';

const router = Router();

function metricsAuthTokenFromRequest(req: Request): string {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(req.headers['x-metrics-token'] || '').trim();
}

router.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'chat-automation-backend' });
});

router.get('/ready', async (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === 'production';
    const exposeDetails = !isProd || Boolean((req as any).auth?.user);
    const checks: Record<string, { ok: boolean; detail?: string }> = {
    runtimeConfig: { ok: false },
    database: { ok: false },
    webhookSecurity: { ok: false },
    secrets: { ok: false },
  };
  try {
        const runtime = getRuntimeConfig();
    checks.runtimeConfig = exposeDetails
      ? { ok: true, detail: runtime.configPath }
      : { ok: true };

    await db.execute(sql`select 1`);
    checks.database = { ok: true };

        const webhookEnvSecret = process.env.WEBHOOK_CALLBACK_SECRET || process.env.N8N_CALLBACK_SECRET;
        let hasDbWebhookSecret = false;
    try {
      hasDbWebhookSecret = await WebhookSecretRepo.hasActiveSecrets();
    } catch {
      hasDbWebhookSecret = false;
    }
        const webhookOk = Boolean(webhookEnvSecret || hasDbWebhookSecret || !isProd);
    checks.webhookSecurity = exposeDetails
      ? { ok: webhookOk, detail: webhookOk ? 'configured' : 'missing callback secret' }
      : { ok: webhookOk };

        const cookieSecretStrong = Boolean(
      process.env.AUTH_COOKIE_SECRET
      && process.env.AUTH_COOKIE_SECRET !== 'dev_auth_secret_change_me',
    );
        const providerKeyStrong = Boolean(
      runtime.providerKeyCrypto.encryptionKey
      && runtime.providerKeyCrypto.encryptionKey.trim().length >= 32,
    );
        const secretOk = isProd ? cookieSecretStrong && providerKeyStrong : true;
    checks.secrets = exposeDetails
      ? { ok: secretOk, detail: secretOk ? 'ok' : 'missing/weak AUTH_COOKIE_SECRET or PROVIDER_API_KEY_ENCRYPTION_KEY' }
      : { ok: secretOk };

        const allOk = Object.values(checks).every((check) => check.ok);
    if (!allOk) {
      if (!exposeDetails) {
        logger.warn({ scope: 'health.ready', message: 'Public readiness check failed' });
        return res.status(503).json({
          status: 'error',
          service: 'chat-automation-backend',
        });
      }
      return res.status(503).json({
        status: 'error',
        service: 'chat-automation-backend',
        checks,
      });
    }

    if (!exposeDetails) {
      return res.json({ status: 'ok', service: 'chat-automation-backend' });
    }
    return res.json({ status: 'ok', service: 'chat-automation-backend', checks });
  } catch (err: any) {
    if (!exposeDetails) {
      logger.warn({ scope: 'health.ready', message: 'Public readiness check failed with exception' });
      return res.status(503).json({
        status: 'error',
        service: 'chat-automation-backend',
      });
    }
    return res.status(503).json({
      status: 'error',
      service: 'chat-automation-backend',
      checks,
      error: { code: 'READINESS_FAILED', message: err?.message || 'Readiness checks failed' },
    });
  }
});

export { router as healthRouter };

router.get('/metrics', (req: Request, res: Response) => {
  const isProd = process.env.NODE_ENV === 'production';
  const runtime = getRuntimeConfig();
  const allowPublic = Boolean(runtime.metricsExporter.allowPublic);
  const requiredToken = String(runtime.metricsExporter.authToken || '').trim();
  const providedToken = metricsAuthTokenFromRequest(req);

  if (isProd && !allowPublic) {
    if (!requiredToken || providedToken !== requiredToken) {
      return res.status(404).json({ status: 'error', message: 'Not found' });
    }
  }

  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(renderPrometheusMetrics());
});
