/**
 * @fileoverview routes/settings.routes.
 *
 * HTTP endpoints, request validation, and response composition for API resources.
 */
import { Router } from 'express';
import { db } from '../db';
import { providerConfigs } from '../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { WebhookSecretRepo } from '../repositories/webhook-secret.repo';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { getRuntimeConfig, updateRuntimeConfigFile } from '../config/runtime.config';
import { assertSafeOutboundUrl, isPrivateOrLocalHost } from '../util/network-safety';
import { UserRepo } from '../repositories/user.repo';

const router = Router();
const IS_PROD = process.env.NODE_ENV === 'production';
const PROVIDER_KEY_ENCRYPTION_KEY = process.env.PROVIDER_API_KEY_ENCRYPTION_KEY || '';
const PROVIDER_KEY_PREFIX = 'enc:v1:';

type ModelCapability = {
    id: string;
    name: string;
    provider: string;
    contextWindow: number | null;
  outputTokenLimit?: number | null;
  raw?: Record<string, unknown>;
};

type RuntimePreferencesDto = {
    approvalMode: 'default' | 'auto';
    forceInteractiveQuestions: boolean;
};

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

/**
 * Normalizes provider base URLs by trimming and removing trailing slash.
 */
function normalizeBaseUrl(baseUrl?: string | null, fallback?: string): string {
    const candidate = (baseUrl || fallback || '').trim();
  return candidate.endsWith('/') ? candidate.slice(0, -1) : candidate;
}

/**
 * Derives AES key material for provider API key encryption/decryption.
 */
function deriveProviderKey(): Buffer | null {
  if (!PROVIDER_KEY_ENCRYPTION_KEY.trim()) return null;
  return crypto.createHash('sha256').update(PROVIDER_KEY_ENCRYPTION_KEY).digest();
}

/**
 * Encrypts provider API keys for at-rest storage in `provider_configs`.
 *
 * @throws {Error} When encryption key is not configured.
 */
function encryptProviderApiKey(plain?: string | null): string | null {
  if (!plain) return null;
    const key = deriveProviderKey();
  if (!key) {
    throw new Error('PROVIDER_API_KEY_ENCRYPTION_KEY is required to store provider API keys securely.');
  }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
  return `${PROVIDER_KEY_PREFIX}${iv.toString('base64url')}:${encrypted.toString('base64url')}:${tag.toString('base64url')}`;
}

/**
 * Decrypts stored provider API key values.
 *
 * @remarks
 * Supports legacy plaintext fallback for backward compatibility.
 */
function decryptProviderApiKey(stored?: string | null): string | null {
  if (!stored) return null;
  // Backward compatibility for legacy plaintext rows.
  if (!stored.startsWith(PROVIDER_KEY_PREFIX)) return stored;
    const key = deriveProviderKey();
  if (!key) {
    if (IS_PROD) {
      throw new Error('Encrypted provider API keys cannot be decrypted because PROVIDER_API_KEY_ENCRYPTION_KEY is missing.');
    }
    return null;
  }
    const raw = stored.slice(PROVIDER_KEY_PREFIX.length);
  const [ivB64, dataB64, tagB64] = raw.split(':');
  if (!ivB64 || !dataB64 || !tagB64) return null;
  try {
        const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
        const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Converts provider config rows into API-safe DTOs without leaking raw keys.
 */
function toProviderView(config: any) {
  return {
    ...config,
    apiKey: null,
    hasApiKey: !!decryptProviderApiKey(config.apiKey),
  };
}

/**
 * Builds runtime preferences payload for settings UI.
 */
function toRuntimePreferencesView(): RuntimePreferencesDto {
    const runtime = getRuntimeConfig();
  return {
    approvalMode: runtime.approvalMode,
    forceInteractiveQuestions: runtime.forceInteractiveQuestions,
  };
}

router.use(requirePrimarySettingsUser);

/**
 * Validates model-discovery base URL against outbound network safety policy.
 */
function assertSafeBaseUrl(base: string) {
    const runtime = getRuntimeConfig();
    const parsed = assertSafeOutboundUrl(base, {
    allowPrivateLocalInDev: runtime.modelFetch.allowPrivate,
    requireHttpsInProd: true,
  });
  if (!runtime.modelFetch.allowPrivate && isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error('Private/local network targets are blocked by server policy');
  }
}

/**
 * Performs bounded JSON fetch with runtime timeout and payload-size guards.
 */
async function safeFetchJson(url: string, init?: RequestInit) {
    const runtime = getRuntimeConfig();
    const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(runtime.modelFetch.timeoutMs),
  });
    const contentLen = response.headers.get('content-length');
  if (contentLen && Number(contentLen) > runtime.modelFetch.maxBytes) {
    throw new Error(`Response too large (${contentLen} bytes)`);
  }
  return response;
}

/**
 * Normalizes provider-specific base URLs for model listing calls.
 */
function normalizeProviderBaseUrl(provider: string, baseUrl?: string | null): string {
    const base = normalizeBaseUrl(baseUrl, defaultBaseUrlForProvider(provider));
  if (provider !== 'ollama_cloud' && provider !== 'ollama') return base;

  try {
        const url = new URL(base);
        const path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('/api/openai/v1') || path.endsWith('/v1')) {
      url.pathname = '';
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // Best-effort fallback below
  }

  if (/\/api\/openai\/v1$/i.test(base) || /\/v1$/i.test(base)) {
    return base.replace(/\/api\/openai\/v1$/i, '').replace(/\/v1$/i, '');
  }
  return base;
}

/**
 * Normalizes OpenAI-compatible base URLs to API-root form for model discovery.
 *
 * @remarks
 * Some providers document full endpoint URLs like `/v1/chat/completions`.
 * Model listing requires `/v1/models`, so we trim endpoint suffixes.
 */
function normalizeOpenAICompatibleBase(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('/chat/completions')) {
      url.pathname = path.replace(/\/chat\/completions$/, '');
      return url.toString().replace(/\/$/, '');
    }
    if (path.endsWith('/completions')) {
      url.pathname = path.replace(/\/completions$/, '');
      return url.toString().replace(/\/$/, '');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return baseUrl
      .replace(/\/chat\/completions\/?$/i, '')
      .replace(/\/completions\/?$/i, '')
      .replace(/\/$/, '');
  }
}

/**
 * Best-effort extraction of upstream JSON error message for non-OK responses.
 */
async function readUpstreamErrorMessage(response: Response): Promise<string | null> {
  try {
    const cloned = response.clone();
    const data = await cloned.json() as any;
    const err = data?.error;
    if (typeof err === 'string' && err.trim()) return err.trim();
    if (typeof err?.message === 'string' && err.message.trim()) return err.message.trim();
    if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  } catch {
    // ignore non-json body
  }
  return null;
}

/**
 * Resolves base URL used for Ollama `/api/tags` calls.
 */
function ollamaTagsBase(baseUrl: string): string {
  try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('/api/openai/v1') || path.endsWith('/v1')) {
      return `${url.origin}`;
    }
  } catch {
    // keep original base as best effort
  }
  return baseUrl.replace(/\/$/, '');
}

/**
 * Fetches model names from Ollama tags endpoint.
 */
async function fetchOllamaTagsModels(base: string, apiKey?: string | null): Promise<string[]> {
  assertSafeBaseUrl(base);
    const tagsBase = ollamaTagsBase(base);
    const response = await safeFetchJson(`${tagsBase}/api/tags`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status} from ${tagsBase}/api/tags`);
  }
    const data = await response.json() as { models?: Array<{ name?: string }> };
  return (data.models || []).map((m) => String(m.name || '')).filter(Boolean);
}

/**
 * Returns default API base URL for a given model provider.
 */
function defaultBaseUrlForProvider(provider: string): string {
  switch (provider) {
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'mistral':
      return 'https://api.mistral.ai/v1';
    case 'ollama_cloud':
      return 'https://ollama.com';
    case 'ollama':
      return getRuntimeConfig().ollamaUrl;
    case 'openai':
    default:
      return 'https://api.openai.com/v1';
  }
}

/**
 * Converts unknown numeric-like values into finite numbers.
 */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
        const n = parseInt(value, 10);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * Returns first valid numeric value from candidate list.
 */
function pickFirstNumber(...values: unknown[]): number | null {
  for (const value of values) {
        const n = asNumber(value);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Fetches model capability metadata from provider-specific model APIs.
 */
async function fetchModelCapabilitiesFromConnection(config: {
    provider: string;
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<ModelCapability[]> {
    const provider = config.provider;

  if (provider === 'openai' || provider === 'groq' || provider === 'mistral') {
        const base = normalizeProviderBaseUrl(provider, config.baseUrl);
    assertSafeBaseUrl(base);
        const response = await safeFetchJson(`${base}/models`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${base}/models`);
        const data = await response.json() as { data?: any[] };

    return (data.data || []).map((m: any) => ({
      id: String(m.id),
      name: String(m.id),
      provider,
      // Some OpenAI-compatible providers expose this; OpenAI usually does not.
      contextWindow: pickFirstNumber(
        m.context_window,
        m.contextWindow,
        m.max_context_length,
        m.maxContextLength,
        m.input_token_limit,
        m.inputTokenLimit,
      ),
      outputTokenLimit: pickFirstNumber(
        m.max_output_tokens,
        m.maxOutputTokens,
        m.output_token_limit,
        m.outputTokenLimit,
      ),
      raw: m,
    }));
  }

  if (provider === 'ollama' || provider === 'ollama_cloud') {
        const base = normalizeProviderBaseUrl(provider, config.baseUrl);
    assertSafeBaseUrl(base);
        const response = await safeFetchJson(`${base}/api/tags`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${base}/api/tags`);
        const data = await response.json() as { models?: any[] };

        const models = data.models || [];
        const details = await Promise.all(models.map(async (m: any) => {
            const modelName = String(m.name);
            let contextWindow: number | null = pickFirstNumber(
        m.context_length,
        m.contextLength,
        m.details?.context_length,
        m.details?.contextLength,
      );

      // Best effort: /api/show often exposes model_info with context length keys.
      try {
                const showRes = await safeFetchJson(`${base}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelName }),
        });

        if (showRes.ok) {
                    const showData = await showRes.json() as any;
                    const modelInfo = showData?.model_info || {};
          contextWindow = contextWindow ?? pickFirstNumber(
            modelInfo['llama.context_length'],
            modelInfo['qwen2.context_length'],
            modelInfo['phi3.context_length'],
            modelInfo['mistral.context_length'],
            modelInfo.context_length,
          );
        }
      } catch {
        // ignore show failures; keep best-effort tag data
      }

      return {
        id: modelName,
        name: modelName,
        provider,
        contextWindow,
        raw: m,
      } satisfies ModelCapability;
    }));

    return details;
  }

  if (provider === 'gemini') {
    if (!config.apiKey) throw new Error('Gemini requires apiKey');

        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`;
        const response = await safeFetchJson(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} from Gemini models API`);
        const data = await response.json() as { models?: any[] };

    return (data.models || []).map((m: any) => ({
      id: String(m.name || '').replace('models/', ''),
      name: String(m.displayName || m.name || '').replace('models/', ''),
      provider,
      contextWindow: pickFirstNumber(m.inputTokenLimit, m.input_token_limit),
      outputTokenLimit: pickFirstNumber(m.outputTokenLimit, m.output_token_limit),
      raw: m,
    }));
  }

  return [];
}

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

// GET all provider configs
router.get('/providers', async (req, res, next) => {
  try {
        const configs = await db.query.providerConfigs.findMany();
    res.json({ status: 'ok', data: configs.map(toProviderView) });
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

  updateRuntimeConfigFile({
    ...(approvalMode ? { approvalMode: approvalMode as 'default' | 'auto' } : {}),
    ...(forceInteractiveQuestions !== undefined ? { forceInteractiveQuestions } : {}),
  });

  return res.json({ status: 'ok', data: toRuntimePreferencesView() });
});

// POST to insert a new provider config
router.post('/providers', async (req, res, next) => {
  try {
    const { provider, model, apiKey, baseUrl, customName } = req.body;
    const normalizedCustomName = typeof customName === 'string' ? customName.trim().slice(0, 80) : '';
    
    // Deactivate existing defaults so the new one becomes the active
    await db.update(providerConfigs).set({ isDefault: false });

    // Insert new one as default
    const [newConfig] = await db.insert(providerConfigs).values({
      id: "prov_" + crypto.randomUUID(),
      provider,
      customName: normalizedCustomName || null,
      model,
      apiKey: encryptProviderApiKey(apiKey || null),
      baseUrl: baseUrl || null,
      isDefault: true
    }).returning();

    res.json({ status: 'ok', data: toProviderView(newConfig) });
  } catch (err) { next(err); }
});

// POST to set a provider as active (default)
router.post('/providers/:id/active', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // First, deactivate all
    await db.update(providerConfigs).set({ isDefault: false });

    // Then, set the desired one to true
    const [updatedConfig] = await db.update(providerConfigs)
      .set({ isDefault: true })
      .where(eq(providerConfigs.id, id))
      .returning();

    if (!updatedConfig) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }

    res.json({ status: 'ok', data: toProviderView(updatedConfig) });
  } catch (err) { next(err); }
});

// PATCH update selected model for a provider config
router.patch('/providers/:id/model', async (req, res, next) => {
  try {
    const { id } = req.params;
        const rawModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    if (!rawModel) {
      return res.status(400).json({ status: 'error', message: 'Model is required' });
    }

    const [updatedConfig] = await db.update(providerConfigs)
      .set({ model: rawModel })
      .where(eq(providerConfigs.id, id))
      .returning();

    if (!updatedConfig) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }

    res.json({ status: 'ok', data: toProviderView(updatedConfig) });
  } catch (err) { next(err); }
});

// DELETE a provider config
router.delete('/providers/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const [deleted] = await db.delete(providerConfigs)
      .where(eq(providerConfigs.id, id))
      .returning();
      
    if (!deleted) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }

    // If we deleted the default one, we might want to make another one default, but let's keep it simple
    res.json({ status: 'ok', data: toProviderView(deleted) });
  } catch (err) { next(err); }
});

// POST to fetch available models dynamically
router.post('/fetch-models', rateLimit({ keyPrefix: 'settings-fetch-models', limit: 20, windowMs: 60_000 }), async (req, res, next) => {
  try {
    const { provider, providerId, baseUrl, apiKey } = req.body;
        let effectiveProvider = typeof provider === 'string' ? provider.trim() : '';
        let effectiveBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
        let effectiveApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';

    if (providerId && typeof providerId === 'string') {
            const savedConfig = await db.query.providerConfigs.findFirst({
        where: eq(providerConfigs.id, providerId.trim()),
      });
      if (!savedConfig) {
        return res.status(404).json({ status: 'error', message: 'Provider not found' });
      }
      effectiveProvider = effectiveProvider || savedConfig.provider;
      effectiveBaseUrl = effectiveBaseUrl || savedConfig.baseUrl || '';
      effectiveApiKey = effectiveApiKey || decryptProviderApiKey(savedConfig.apiKey) || '';
    }

    if (!effectiveProvider) {
      return res.status(400).json({ status: 'error', message: 'Provider is required' });
    }

        let models: string[] = [];

    if (effectiveProvider === 'openai' || effectiveProvider === 'groq' || effectiveProvider === 'mistral') {
            const normalized = normalizeProviderBaseUrl(effectiveProvider, effectiveBaseUrl);
      assertSafeBaseUrl(normalized);
            const apiBase = normalizeOpenAICompatibleBase(normalized);
            const url = `${apiBase}/models`;
            const response = await safeFetchJson(url, {
        headers: effectiveApiKey ? { 'Authorization': `Bearer ${effectiveApiKey}` } : {}
      });
      if (!response.ok) {
        // Some OpenAI-compatible endpoints don't expose /models.
        if (response.status === 404 || response.status === 405) {
          return res.json({ status: 'ok', data: [] });
        }
        const upstream = await readUpstreamErrorMessage(response);
        throw new Error(upstream ? `HTTP Error: ${response.status} from ${url} - ${upstream}` : `HTTP Error: ${response.status} from ${url}`);
      }
            const data = await response.json();
      models = data.data?.map((m: any) => m.id) || [];
    } else if (effectiveProvider === 'ollama' || effectiveProvider === 'ollama_cloud') {
            const normalized = normalizeProviderBaseUrl(effectiveProvider, effectiveBaseUrl);
      assertSafeBaseUrl(normalized);
      models = await fetchOllamaTagsModels(normalized, effectiveApiKey);
    } else if (effectiveProvider === 'gemini') {
      if (!effectiveApiKey) {
        return res.status(400).json({ status: 'error', message: 'API key is required for Gemini model discovery' });
      }
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveApiKey}`;
            const response = await safeFetchJson(url);
      if (!response.ok) throw new Error(`HTTP Error: ${response.status} from ${url}`);
            const data = await response.json();
      models = data.models?.map((m: any) => m.name.replace('models/', '')) || [];
    }

    res.json({ status: 'ok', data: models });
  } catch (err: any) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

// Fetch model capabilities from saved provider connections (live, best-effort)
router.get('/providers/model-capabilities', rateLimit({ keyPrefix: 'settings-model-capabilities', limit: 15, windowMs: 60_000 }), async (req, res) => {
  try {
        const configs = await db.query.providerConfigs.findMany();
        const results = await Promise.all(configs.map(async (cfg) => {
      try {
                const capabilities = await fetchModelCapabilitiesFromConnection({
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          apiKey: decryptProviderApiKey(cfg.apiKey),
        });

        return {
          providerConfigId: cfg.id,
          provider: cfg.provider,
          isDefault: cfg.isDefault,
          configuredModel: cfg.model,
          status: 'ok' as const,
          models: capabilities,
        };
      } catch (err: any) {
        return {
          providerConfigId: cfg.id,
          provider: cfg.provider,
          isDefault: cfg.isDefault,
          configuredModel: cfg.model,
          status: 'error' as const,
          error: err?.message || 'failed_to_fetch_models',
          models: [],
        };
      }
    }));

    res.json({ status: 'ok', data: results });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err?.message || 'Internal server error' });
  }
});

// GET webhook callback secrets (masked metadata only)
router.get('/webhook-secrets', async (req, res, next) => {
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
