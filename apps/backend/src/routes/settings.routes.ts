import { Router } from 'express';
import { db } from '../db';
import { providerConfigs } from '../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

const router = Router();

type ModelCapability = {
  id: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  outputTokenLimit?: number | null;
  raw?: Record<string, unknown>;
};

function normalizeBaseUrl(baseUrl?: string | null, fallback?: string): string {
  const candidate = (baseUrl || fallback || '').trim();
  return candidate.endsWith('/') ? candidate.slice(0, -1) : candidate;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickFirstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = asNumber(value);
    if (n !== null) return n;
  }
  return null;
}

async function fetchModelCapabilitiesFromConnection(config: {
  provider: string;
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<ModelCapability[]> {
  const provider = config.provider;

  if (provider === 'openai' || provider === 'groq' || provider === 'mistral') {
    const base = normalizeBaseUrl(config.baseUrl, 'https://api.openai.com/v1');
    const response = await fetch(`${base}/models`, {
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

  if (provider === 'ollama') {
    const base = normalizeBaseUrl(config.baseUrl, 'http://localhost:11434');
    const response = await fetch(`${base}/api/tags`);
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
        const showRes = await fetch(`${base}/api/show`, {
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
    const response = await fetch(url);
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

// GET all provider configs
router.get('/providers', async (req, res, next) => {
  try {
    const configs = await db.query.providerConfigs.findMany();
    res.json({ status: 'ok', data: configs });
  } catch (err) { next(err); }
});

// POST to insert a new provider config
router.post('/providers', async (req, res, next) => {
  try {
    const { provider, model, apiKey, baseUrl } = req.body;
    
    // Deactivate existing defaults so the new one becomes the active
    await db.update(providerConfigs).set({ isDefault: false });

    // Insert new one as default
    const [newConfig] = await db.insert(providerConfigs).values({
      id: "prov_" + crypto.randomUUID(),
      provider,
      model,
      apiKey: apiKey || null,
      baseUrl: baseUrl || null,
      isDefault: true
    }).returning();

    res.json({ status: 'ok', data: newConfig });
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

    res.json({ status: 'ok', data: updatedConfig });
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
    res.json({ status: 'ok', data: deleted });
  } catch (err) { next(err); }
});

// POST to fetch available models dynamically
router.post('/fetch-models', async (req, res, next) => {
  try {
    const { provider, baseUrl, apiKey } = req.body;
    let models: string[] = [];

    if (provider === 'openai' || provider === 'groq' || provider === 'mistral') {
      const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/models` : 'https://api.openai.com/v1/models';
      const response = await fetch(url, {
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
      });
      if (!response.ok) throw new Error(`HTTP Error: ${response.status} from ${url}`);
      const data = await response.json();
      models = data.data?.map((m: any) => m.id) || [];
    } else if (provider === 'ollama') {
      const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api/tags` : 'http://localhost:11434/api/tags';
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP Error: ${response.status} from ${url}`);
      const data = await response.json();
      models = data.models?.map((m: any) => m.name) || [];
    } else if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const response = await fetch(url);
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
router.get('/providers/model-capabilities', async (req, res) => {
  try {
    const configs = await db.query.providerConfigs.findMany();
    const results = await Promise.all(configs.map(async (cfg) => {
      try {
        const capabilities = await fetchModelCapabilitiesFromConnection({
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
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

export { router as settingsRouter };
