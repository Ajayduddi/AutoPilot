/**
 * @fileoverview apps/backend/src/services/settings/settings-model-discovery.service.ts
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { getRuntimeConfig } from "../../config/runtime.config";
import { assertSafeOutboundUrl, isPrivateOrLocalHost } from "../../util/network-safety";
import { incrementCounter, observeHistogram } from "../../util/metrics";

export type ModelCapability = {
  id: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  outputTokenLimit?: number | null;
  raw?: Record<string, unknown>;
};

type ModelDiscoveryCacheEntry = {
  expiresAt: number;
  capabilities: ModelCapability[];
};

const MODEL_DISCOVERY_CACHE_TTL_MS = 30_000;
const MODEL_DISCOVERY_CACHE_MAX_ENTRIES = 64;
const MODEL_DISCOVERY_MAX_CONCURRENCY = 4;

const modelDiscoveryCache = new Map<string, ModelDiscoveryCacheEntry>();
const modelDiscoveryInflight = new Map<string, Promise<ModelCapability[]>>();

function normalizeBaseUrl(baseUrl?: string | null, fallback?: string): string {
  const candidate = (baseUrl || fallback || "").trim();
  return candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
}

function defaultBaseUrlForProvider(provider: string): string {
  switch (provider) {
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "mistral":
      return "https://api.mistral.ai/v1";
    case "ollama_cloud":
      return "https://ollama.com";
    case "ollama":
      return getRuntimeConfig().ollamaUrl;
    case "openai":
    default:
      return "https://api.openai.com/v1";
  }
}

function toResultCountBucket(count: number): string {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2_5";
  if (count <= 10) return "6_10";
  return "11_plus";
}

function pruneModelDiscoveryCache(now = Date.now()) {
  for (const [key, entry] of modelDiscoveryCache.entries()) {
    if (entry.expiresAt <= now) {
      modelDiscoveryCache.delete(key);
    }
  }

  if (modelDiscoveryCache.size <= MODEL_DISCOVERY_CACHE_MAX_ENTRIES) return;
  const entries = [...modelDiscoveryCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const excess = entries.length - MODEL_DISCOVERY_CACHE_MAX_ENTRIES;
  for (const [key] of entries.slice(0, excess)) {
    modelDiscoveryCache.delete(key);
  }
}

export function invalidateModelDiscoveryCache(prefix?: string) {
  if (!prefix) {
    modelDiscoveryCache.clear();
    modelDiscoveryInflight.clear();
    return;
  }
  for (const key of modelDiscoveryCache.keys()) {
    if (key.startsWith(prefix)) {
      modelDiscoveryCache.delete(key);
    }
  }
  for (const key of modelDiscoveryInflight.keys()) {
    if (key.startsWith(prefix)) {
      modelDiscoveryInflight.delete(key);
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

export async function mapModelDiscoveryWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  return await mapWithConcurrency(items, MODEL_DISCOVERY_MAX_CONCURRENCY, mapper);
}

function assertSafeBaseUrl(base: string) {
  const runtime = getRuntimeConfig();
  const parsed = assertSafeOutboundUrl(base, {
    allowPrivateLocalInDev: runtime.modelFetch.allowPrivate,
    requireHttpsInProd: true,
  });
  if (!runtime.modelFetch.allowPrivate && isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error("Private/local network targets are blocked by server policy");
  }
}

async function safeFetchJson(url: string, init?: RequestInit) {
  const runtime = getRuntimeConfig();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(runtime.modelFetch.timeoutMs),
  });
  const contentLen = response.headers.get("content-length");
  if (contentLen && Number(contentLen) > runtime.modelFetch.maxBytes) {
    throw new Error(`Response too large (${contentLen} bytes)`);
  }
  return response;
}

async function readResponseTextBounded(response: Response): Promise<string> {
  const runtime = getRuntimeConfig();
  const maxBytes = runtime.modelFetch.maxBytes;
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    const size = new TextEncoder().encode(text).byteLength;
    if (size > maxBytes) {
      throw new Error(`Response too large (${size} bytes)`);
    }
    return text;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`Response too large (${totalBytes} bytes)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function safeReadJson<T>(response: Response): Promise<T> {
  const text = await readResponseTextBounded(response);
  return JSON.parse(text) as T;
}

function normalizeProviderBaseUrl(provider: string, baseUrl?: string | null): string {
  const base = normalizeBaseUrl(baseUrl, defaultBaseUrlForProvider(provider));
  if (provider !== "ollama_cloud" && provider !== "ollama") return base;

  try {
    const url = new URL(base);
    const path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/api/openai/v1") || path.endsWith("/v1")) {
      url.pathname = "";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // keep best effort fallback below
  }

  if (/\/api\/openai\/v1$/i.test(base) || /\/v1$/i.test(base)) {
    return base.replace(/\/api\/openai\/v1$/i, "").replace(/\/v1$/i, "");
  }
  return base;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) return parsed;
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

  if (provider === "openai" || provider === "groq" || provider === "mistral" || provider === "minimax" || provider === "custom") {
    const base = normalizeProviderBaseUrl(provider, config.baseUrl);
    assertSafeBaseUrl(base);
    const response = await safeFetchJson(`${base}/models`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });

    if (!response.ok) {
      // 404 or 405 is common for custom OpenAI-compatible APIs that lack a /models endpoint
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        return [];
      }
      let errCtx = "";
      try { errCtx = (await response.text()).slice(0, 50); } catch { /* ignore */ }
      throw new Error(`HTTP ${response.status} from ${base}/models${errCtx ? ' ' + errCtx : ''}`);
    }

    let data: any;
    try {
      data = await safeReadJson<any>(response);
    } catch {
      return []; // Return empty if the provider replied with non-JSON success
    }

    const modelsList = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

    return modelsList.map((model: any) => ({
      id: String(model?.id || model?.name || ""),
      name: String(model?.id || model?.name || ""),
      provider,
      contextWindow: pickFirstNumber(
        model?.context_window,
        model?.contextWindow,
        model?.max_context_length,
        model?.maxContextLength,
        model?.input_token_limit,
        model?.inputTokenLimit,
      ),
      outputTokenLimit: pickFirstNumber(
        model?.max_output_tokens,
        model?.maxOutputTokens,
        model?.output_token_limit,
        model?.outputTokenLimit,
      ),
      raw: model,
    })).filter((m: any) => m.id);
  }

  if (provider === "ollama" || provider === "ollama_cloud") {
    const base = normalizeProviderBaseUrl(provider, config.baseUrl);
    assertSafeBaseUrl(base);
    const response = await safeFetchJson(`${base}/api/tags`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${base}/api/tags`);
    const data = await safeReadJson<{ models?: any[] }>(response);

    return await mapWithConcurrency(data.models || [], MODEL_DISCOVERY_MAX_CONCURRENCY, async (model: any) => {
      const modelName = String(model.name);
      let contextWindow: number | null = pickFirstNumber(
        model.context_length,
        model.contextLength,
        model.details?.context_length,
        model.details?.contextLength,
      );

      try {
        const showRes = await safeFetchJson(`${base}/api/show`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: modelName }),
        });

        if (showRes.ok) {
          const showData = await safeReadJson<any>(showRes);
          const modelInfo = showData?.model_info || {};
          contextWindow = contextWindow ?? pickFirstNumber(
            modelInfo["llama.context_length"],
            modelInfo["qwen2.context_length"],
            modelInfo["phi3.context_length"],
            modelInfo["mistral.context_length"],
            modelInfo.context_length,
          );
        }
      } catch {
        // keep best effort tag data
      }

      return {
        id: modelName,
        name: modelName,
        provider,
        contextWindow,
        raw: model,
      } satisfies ModelCapability;
    });
  }

  if (provider === "gemini") {
    if (!config.apiKey) throw new Error("Gemini requires apiKey");

    const response = await safeFetchJson("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": config.apiKey },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from Gemini models API`);
    const data = await safeReadJson<{ models?: any[] }>(response);

    return (data.models || []).map((model: any) => ({
      id: String(model.name || "").replace("models/", ""),
      name: String(model.displayName || model.name || "").replace("models/", ""),
      provider,
      contextWindow: pickFirstNumber(model.inputTokenLimit, model.input_token_limit),
      outputTokenLimit: pickFirstNumber(model.outputTokenLimit, model.output_token_limit),
      raw: model,
    }));
  }

  return [];
}

function modelDiscoveryCacheKey(input: {
  provider: string;
  providerConfigId?: string | null;
  baseUrl?: string | null;
}) {
  const provider = String(input.provider || "").trim().toLowerCase();
  const providerConfigId = String(input.providerConfigId || "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl || "");
  return providerConfigId ? `provider:${providerConfigId}` : `provider:${provider}|base:${baseUrl}`;
}

export async function getCachedModelCapabilities(input: {
  provider: string;
  providerConfigId?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<ModelCapability[]> {
  const cacheKey = modelDiscoveryCacheKey(input);
  const provider = String(input.provider || "").trim().toLowerCase() || "unknown";
  pruneModelDiscoveryCache();
  const cached = modelDiscoveryCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    incrementCounter("autopilot_settings_model_discovery_cache_total", {
      provider,
      outcome: "hit",
    });
    return cached.capabilities;
  }

  const inflight = modelDiscoveryInflight.get(cacheKey);
  if (inflight) {
    incrementCounter("autopilot_settings_model_discovery_cache_total", {
      provider,
      outcome: "shared",
    });
    return await inflight;
  }

  incrementCounter("autopilot_settings_model_discovery_cache_total", {
    provider,
    outcome: cached ? "stale_refresh" : "miss",
  });
  const startedAt = performance.now();

  const fetchPromise = (async () => {
    try {
      const capabilities = await fetchModelCapabilitiesFromConnection(input);
      modelDiscoveryCache.set(cacheKey, {
        expiresAt: Date.now() + MODEL_DISCOVERY_CACHE_TTL_MS,
        capabilities,
      });
      pruneModelDiscoveryCache();
      observeHistogram("autopilot_settings_model_discovery_latency_ms", performance.now() - startedAt, {
        provider,
        outcome: "fresh",
        resultBucket: toResultCountBucket(capabilities.length),
      });
      return capabilities;
    } catch (error) {
      if (cached?.capabilities?.length) {
        incrementCounter("autopilot_settings_model_discovery_cache_total", {
          provider,
          outcome: "stale_fallback",
        });
        observeHistogram("autopilot_settings_model_discovery_latency_ms", performance.now() - startedAt, {
          provider,
          outcome: "stale_fallback",
          resultBucket: toResultCountBucket(cached.capabilities.length),
        });
        return cached.capabilities;
      }
      incrementCounter("autopilot_settings_model_discovery_cache_total", {
        provider,
        outcome: "error",
      });
      observeHistogram("autopilot_settings_model_discovery_latency_ms", performance.now() - startedAt, {
        provider,
        outcome: "error",
        resultBucket: "0",
      });
      throw error;
    } finally {
      modelDiscoveryInflight.delete(cacheKey);
    }
  })();

  modelDiscoveryInflight.set(cacheKey, fetchPromise);
  return await fetchPromise;
}

export function isEmbeddingModelCapability(input: ModelCapability): boolean {
  const id = String(input.id || "").trim().toLowerCase();
  const name = String(input.name || "").trim().toLowerCase();
  const haystack = `${id} ${name}`;
  if (!haystack) return false;

  if (
    haystack.includes("embedding")
    || haystack.includes("embed")
    || haystack.includes("bge")
    || haystack.includes("minilm")
    || haystack.includes("e5")
    || haystack.includes("gte")
  ) {
    return true;
  }

  const raw = (input.raw || {}) as Record<string, unknown>;
  const methods = Array.isArray(raw.supportedGenerationMethods)
    ? raw.supportedGenerationMethods.map((value) => String(value || "").toLowerCase())
    : [];
  return methods.some((value) => value.includes("embed"));
}
