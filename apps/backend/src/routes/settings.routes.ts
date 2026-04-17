/**
 * @fileoverview routes/settings.routes.
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
import { Router } from 'express';
import { db } from '../db';
import { WebhookSecretRepo } from '../repositories/webhook-secret.repo';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { updateRuntimeConfigFileAsync } from '../config/runtime.config';
import { UserRepo } from '../repositories/user.repo';
import { ProviderConfigRepo } from '../repositories/provider-config.repo';
import {
  getCachedModelCapabilities,
  isEmbeddingModelCapability,
  mapModelDiscoveryWithConcurrency,
} from '../services/settings/settings-model-discovery.service';
import {
  activateProvider,
  createProvider,
  deleteProvider,
  findProviderConfigById,
  listProviderViews,
  toProviderDisplayLabel,
  toRetrievalPreferencesView,
  toRuntimePreferencesView,
  updateProviderModel,
  updateRetrievalPreferences,
} from '../services/settings/settings-provider.service';

const router = Router();

/**
 * Ensures settings endpoints are accessible only to the configured primary user.
 */
async function requirePrimarySettingsUser(req: any, res: any, next: any) {
  try {
        const userId = req.auth?.user?.id;
    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }
        const allowed = await UserRepo.canUseAsSingleUser(userId);
    if (!allowed) {
      return res.status(403).json({ status: 'error', message: 'Settings administration is restricted to the primary user' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.use(requirePrimarySettingsUser);

/**
 * Converts webhook secret row into response-safe DTO.
 */
function toWebhookSecretView(secret: any) {
  return {
    id: secret.id,
    label: secret.label,
    secretPrefix: secret.secretPrefix,
    createdAt: secret.createdAt,
    lastUsedAt: secret.lastUsedAt,
    revokedAt: secret.revokedAt,
  };
}

/**
 * Detects missing table errors for webhook secret persistence.
 */
function isWebhookSecretsTableMissing(err: unknown): boolean {
    const message = (err as { message?: string })?.message || '';
  return message.includes('webhook_secrets') && (
    message.includes('does not exist')
    || message.includes('relation')
    || message.includes('undefined_table')
  );
}

router.get('/providers', async (_req, res, next) => {
  try {
    res.json({ status: 'ok', data: await listProviderViews() });
  } catch (err) { next(err); }
});

router.get('/runtime-preferences', async (_req, res) => {
  res.json({ status: 'ok', data: toRuntimePreferencesView() });
});

router.patch('/runtime-preferences', async (req, res) => {
    const approvalMode = typeof req.body?.approvalMode === 'string'
    ? req.body.approvalMode.trim().toLowerCase()
    : undefined;
    const forceInteractiveQuestions = typeof req.body?.forceInteractiveQuestions === 'boolean'
    ? req.body.forceInteractiveQuestions
    : undefined;

  if (approvalMode !== undefined && approvalMode !== 'default' && approvalMode !== 'auto') {
    return res.status(400).json({ status: 'error', message: 'approvalMode must be "default" or "auto"' });
  }

  await updateRuntimeConfigFileAsync({
    ...(approvalMode ? { approvalMode: approvalMode as 'default' | 'auto' } : {}),
    ...(forceInteractiveQuestions !== undefined ? { forceInteractiveQuestions } : {}),
  });

  return res.json({ status: 'ok', data: toRuntimePreferencesView() });
});

router.get('/retrieval-preferences', async (_req, res, next) => {
  try {
    const view = await toRetrievalPreferencesView();
    return res.json({ status: 'ok', data: view });
  } catch (err) {
    next(err);
  }
});

router.patch('/retrieval-preferences', async (req, res, next) => {
  try {
    const result = await updateRetrievalPreferences(req.body);
    if (!result.ok) {
      return res.status(result.status).json({ status: 'error', message: result.message });
    }
    return res.json({ status: 'ok', data: result.view });
  } catch (err) {
    next(err);
  }
});

router.post('/providers', async (req, res, next) => {
  try {
    const { provider, model, apiKey, baseUrl, customName } = req.body;
    res.json({
      status: 'ok',
      data: await createProvider({ provider, model, apiKey, baseUrl, customName }),
    });
  } catch (err) { next(err); }
});

router.post('/providers/:id/active', async (req, res, next) => {
  try {
    const updatedConfig = await activateProvider(req.params.id);
    if (!updatedConfig) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }
    res.json({ status: 'ok', data: updatedConfig });
  } catch (err) { next(err); }
});

router.patch('/providers/:id/model', async (req, res, next) => {
  try {
    const rawModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    if (!rawModel) {
      return res.status(400).json({ status: 'error', message: 'Model is required' });
    }
    const updatedConfig = await updateProviderModel(req.params.id, rawModel);
    if (!updatedConfig) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }
    res.json({ status: 'ok', data: updatedConfig });
  } catch (err) { next(err); }
});

router.delete('/providers/:id', async (req, res, next) => {
  try {
    const deleted = await deleteProvider(req.params.id);
    if (!deleted) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }
    res.json({ status: 'ok', data: deleted });
  } catch (err) { next(err); }
});

// POST to fetch available models dynamically
router.post('/fetch-models', rateLimit({ keyPrefix: 'settings-fetch-models', limit: 20, windowMs: 60_000 }), async (req, res) => {
  try {
    const { provider, providerId, baseUrl } = req.body;
    let effectiveProvider = typeof provider === 'string' ? provider.trim() : '';
    let effectiveBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    let effectiveApiKey = '';
    const effectiveProviderId = typeof providerId === 'string' ? providerId.trim() : '';

    if (effectiveProviderId) {
      const savedConfig = await findProviderConfigById(effectiveProviderId);
      if (!savedConfig) {
        return res.status(404).json({ status: 'error', message: 'Provider not found' });
      }
      // Saved provider connections are the source of truth for remote discovery.
      effectiveProvider = savedConfig.provider;
      effectiveBaseUrl = savedConfig.baseUrl || '';
      effectiveApiKey = effectiveApiKey || await ProviderConfigRepo.decryptApiKey(savedConfig) || '';
    }

    if (!effectiveProviderId) {
      return res.status(400).json({ status: 'error', message: 'providerId is required for model discovery' });
    }

    if (!effectiveProvider) {
      return res.status(400).json({ status: 'error', message: 'Provider is required' });
    }

    // Browser-driven discovery can now probe remote APIs (like OpenAI-compatible ones) leveraging SSRF protections in the discovery service.

    const capabilities = await getCachedModelCapabilities({
      provider: effectiveProvider,
      providerConfigId: effectiveProviderId || null,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
    });
        const models = capabilities.map((item) => item.id).filter(Boolean);

    res.json({ status: 'ok', data: models });
  } catch (err: any) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

// Fetch model capabilities from saved provider connections (live, best-effort)
router.get('/providers/model-capabilities', rateLimit({ keyPrefix: 'settings-model-capabilities', limit: 15, windowMs: 60_000 }), async (req, res) => {
  try {
    const embeddingOnly = String(req.query?.embeddingOnly || '').trim().toLowerCase() === 'true';
    const configs = await ProviderConfigRepo.list();
    const results = await mapModelDiscoveryWithConcurrency(configs, async (cfg) => {
      try {
        const capabilities = await getCachedModelCapabilities({
          provider: cfg.provider,
          providerConfigId: cfg.id,
          baseUrl: cfg.baseUrl,
          apiKey: await ProviderConfigRepo.decryptApiKey(cfg),
        });
        const filteredCapabilities = embeddingOnly
          ? capabilities.filter((item) => isEmbeddingModelCapability(item))
          : capabilities;

        return {
          providerConfigId: cfg.id,
          provider: cfg.provider,
          connectionName: toProviderDisplayLabel(cfg.provider, cfg.customName),
          isDefault: cfg.isDefault,
          configuredModel: cfg.model,
          status: 'ok' as const,
          models: filteredCapabilities,
        };
      } catch (err: any) {
        return {
          providerConfigId: cfg.id,
          provider: cfg.provider,
          connectionName: toProviderDisplayLabel(cfg.provider, cfg.customName),
          isDefault: cfg.isDefault,
          configuredModel: cfg.model,
          status: 'error' as const,
          error: err?.message || 'failed_to_fetch_models',
          models: [],
        };
      }
    });

    res.json({ status: 'ok', data: results });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err?.message || 'Internal server error' });
  }
});

// GET webhook callback secrets (masked metadata only)
router.get('/webhook-secrets', async (_req, res, next) => {
  try {
        const secrets = await WebhookSecretRepo.listSecrets();
    res.json({ status: 'ok', data: secrets.map(toWebhookSecretView) });
  } catch (err) {
    if (isWebhookSecretsTableMissing(err)) {
      return res.json({
        status: 'ok',
        data: [],
                meta: { warning: 'webhook_secrets table missing; run `bun run db:push` in apps/backend' },
      });
    }
    next(err);
  }
});

// POST generate a new webhook callback secret (secret returned once)
router.post('/webhook-secrets', async (req, res, next) => {
  try {
        const rawLabel = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
        const label = rawLabel ? rawLabel.slice(0, 80) : `Callback Key ${new Date().toISOString().slice(0, 10)}`;

    const { created, secret } = await WebhookSecretRepo.createSecret({
      label,
      createdByUserId: null,
    });

    res.status(201).json({
      status: 'ok',
      data: {
        ...toWebhookSecretView(created),
        secret,
      },
    });
  } catch (err) {
    if (isWebhookSecretsTableMissing(err)) {
      return res.status(503).json({
        error: 'Webhook secret storage not initialized. Run `cd apps/backend && bun run db:push`.',
      });
    }
    next(err);
  }
});

// DELETE revoke an active webhook callback secret
router.delete('/webhook-secrets/:id', async (req, res, next) => {
  try {
        const updated = await WebhookSecretRepo.revokeSecret(req.params.id);
    if (!updated) {
      return res.status(404).json({ status: 'error', message: 'Webhook secret not found or already revoked' });
    }
    res.json({ status: 'ok', data: toWebhookSecretView(updated) });
  } catch (err) {
    if (isWebhookSecretsTableMissing(err)) {
      return res.status(503).json({
        error: 'Webhook secret storage not initialized. Run `cd apps/backend && bun run db:push`.',
      });
    }
    next(err);
  }
});

/**
 * Settings router for provider configuration, runtime preferences, and webhook secret management.
 *
 * @remarks
 * Mounted at `/api/settings` behind `requireAuth`; applies primary-user guard.
 */
export { router as settingsRouter };
