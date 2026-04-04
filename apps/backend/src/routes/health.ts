/**
 * @fileoverview routes/health.
 *
 * HTTP endpoints, request validation, and response composition for API resources.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getRuntimeConfig } from '../config/runtime.config';
import { WebhookSecretRepo } from '../repositories/webhook-secret.repo';
import { renderPrometheusMetrics } from '../util/metrics';

const router = Router();
const IS_PROD = process.env.NODE_ENV === 'production';

router.get('/', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'chat-automation-backend' });
});

router.get('/ready', async (req: Request, res: Response) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {
    runtimeConfig: { ok: false },
    database: { ok: false },
    webhookSecurity: { ok: false },
    secrets: { ok: false },
  };
  try {
        const runtime = getRuntimeConfig();
    checks.runtimeConfig = {
      ok: true,
      detail: runtime.configPath,
    };

    await db.execute(sql`select 1`);
    checks.database = { ok: true };

        const webhookEnvSecret = process.env.WEBHOOK_CALLBACK_SECRET || process.env.N8N_CALLBACK_SECRET;
        let hasDbWebhookSecret = false;
    try {
      hasDbWebhookSecret = await WebhookSecretRepo.hasActiveSecrets();
    } catch {
      hasDbWebhookSecret = false;
    }
        const webhookOk = Boolean(webhookEnvSecret || hasDbWebhookSecret || !IS_PROD);
    checks.webhookSecurity = {
      ok: webhookOk,
      detail: webhookOk ? 'configured' : 'missing callback secret',
    };

        const cookieSecretStrong = Boolean(
      process.env.AUTH_COOKIE_SECRET
      && process.env.AUTH_COOKIE_SECRET !== 'dev_auth_secret_change_me',
    );
        const providerKeyStrong = Boolean(
      process.env.PROVIDER_API_KEY_ENCRYPTION_KEY
      && process.env.PROVIDER_API_KEY_ENCRYPTION_KEY.trim().length >= 32,
    );
        const secretOk = IS_PROD ? cookieSecretStrong && providerKeyStrong : true;
    checks.secrets = {
      ok: secretOk,
      detail: secretOk ? 'ok' : 'missing/weak AUTH_COOKIE_SECRET or PROVIDER_API_KEY_ENCRYPTION_KEY',
    };

        const allOk = Object.values(checks).every((check) => check.ok);
    if (!allOk) {
      return res.status(503).json({
        status: 'error',
        service: 'chat-automation-backend',
        checks,
      });
    }

    return res.json({ status: 'ok', service: 'chat-automation-backend', checks });
  } catch (err: any) {
    return res.status(503).json({
      status: 'error',
      service: 'chat-automation-backend',
      checks,
      error: { code: 'READINESS_FAILED', message: err?.message || 'Readiness checks failed' },
    });
  }
});

export { router as healthRouter };

router.get('/metrics', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(renderPrometheusMetrics());
});
