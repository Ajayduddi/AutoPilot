/**
 * @fileoverview apps/backend/src/services/settings/settings-provider.service.ts
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
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { providerConfigs } from "../../db/schema";
import { getRuntimeConfig, updateRuntimeConfigFileAsync } from "../../config/runtime.config";
import { resetEmbeddingConfigCache } from "../../config/embedding.config";
import { decryptProviderApiKey, encryptProviderApiKey } from "../../util/provider-key-crypto";
import { invalidateModelDiscoveryCache } from "./settings-model-discovery.service";
import { ProviderConfigRepo } from "../../repositories/provider-config.repo";

const EMBEDDING_PROVIDERS = ["api", "bge_local", "minilm_local"] as const;
type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

export type RuntimePreferencesDto = {
  approvalMode: "default" | "auto";
  forceInteractiveQuestions: boolean;
};

export type RetrievalPreferencesDto = {
  embeddingProvider: "api" | "bge_local" | "minilm_local";
  embeddingApiProvider: string;
  embeddingApiProviderId: string;
  embeddingsIndexBatchSize: number;
  embeddingsRetryMaxAttempts: number;
  embeddingsRetryBaseDelayMs: number;
  embeddingVectorDimensions: number;
  embeddingModel: string;
  embeddingMaxBatchSize: number;
  embeddingCacheDir: string;
  embeddingAllowRemoteModels: boolean;
  embeddingQuantized: boolean;
  semanticSearchTopKDefault: number;
  semanticSearchMinScore: number;
  ragMaxChunks: number;
  ragChunkTokenBudget: number;
  currentEmbeddingModelLabel: string;
  currentEmbeddingProviderLabel: string;
};

function asOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim();
  return undefined;
}

function validateIntegerField(name: string, value: number | undefined, min: number, max: number, errors: string[]) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer between ${min} and ${max}`);
  }
}

export function toRuntimePreferencesView(): RuntimePreferencesDto {
  const runtime = getRuntimeConfig();
  return {
    approvalMode: runtime.approvalMode,
    forceInteractiveQuestions: runtime.forceInteractiveQuestions,
  };
}

export function toProviderDisplayLabel(provider: string, customName?: string | null): string {
  const preferred = String(customName || "").trim();
  if (preferred) return preferred;
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "openai") return "OpenAI Compatible API";
  if (normalized === "ollama_cloud") return "Ollama";
  if (!normalized) return "Provider";
  return normalized
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function toProviderView(config: any) {
  const { apiKey: _apiKey, ...rest } = config;
  return {
    ...rest,
    hasApiKey: !!(await ProviderConfigRepo.decryptApiKey(config)),
  };
}

export async function listProviderViews() {
  const configs = await ProviderConfigRepo.list();
  return await Promise.all(configs.map(toProviderView));
}

export async function findProviderConfigById(id?: string | null) {
  const normalized = String(id || "").trim();
  if (!normalized) return null;
  return ProviderConfigRepo.findById(normalized);
}

export async function findApiEmbeddingProviderConfig(input: {
  provider?: string;
  providerId?: string;
  model?: string;
}) {
  const byId = await findProviderConfigById(input.providerId);
  if (byId) return byId;

  const normalizedProvider = String(input.provider || "").trim().toLowerCase();
  const normalizedModel = String(input.model || "").trim();
  if (!normalizedProvider) return null;

  const rows = await ProviderConfigRepo.findByProvider(normalizedProvider);
  if (!rows.length) return null;

  const exactModel = normalizedModel
    ? rows.find((row) => String(row.model || "").trim() === normalizedModel)
    : null;
  if (exactModel) return exactModel;

  const defaultRow = rows.find((row) => row.isDefault);
  return defaultRow || rows[0] || null;
}

function toCurrentEmbeddingProviderLabel(provider: EmbeddingProviderName, apiProviderLabel?: string): string {
  if (provider === "bge_local") return "BGE Local";
  if (provider === "minilm_local") return "MiniLM Local";
  return String(apiProviderLabel || "").trim() || "API Provider";
}

function toCurrentEmbeddingModelLabel(input: {
  provider: EmbeddingProviderName;
  providerLabel?: string;
  model: string;
}): string {
  const model = input.model.trim();
  if (!model) return "Not set";
  return `${toCurrentEmbeddingProviderLabel(input.provider, input.providerLabel)}: ${model}`;
}

function inferEmbeddingProviderFromSavedModel(
  model: string,
  apiProvider?: string,
  apiProviderId?: string,
): EmbeddingProviderName {
  const normalized = String(model || "").trim();
  if (normalized === "Xenova/bge-small-en-v1.5") return "bge_local";
  if (normalized === "Xenova/all-MiniLM-L6-v2") return "minilm_local";
  if (String(apiProviderId || "").trim() || String(apiProvider || "").trim()) return "api";
  return "api";
}

export async function toRetrievalPreferencesView(): Promise<RetrievalPreferencesDto> {
  const runtime = getRuntimeConfig();
  const r = runtime.retrievalEmbedding;
  const effectiveModel = String(r.embeddingModel || "").trim();
  const normalizedEmbeddingProvider = inferEmbeddingProviderFromSavedModel(
    effectiveModel || r.embeddingModel,
    r.embeddingApiProvider,
    r.embeddingApiProviderId,
  );
  const providerConfig = normalizedEmbeddingProvider === "api"
    ? await findApiEmbeddingProviderConfig({
        provider: r.embeddingApiProvider,
        providerId: r.embeddingApiProviderId,
        model: r.embeddingModel,
      })
    : null;
  const embeddingApiProvider = normalizedEmbeddingProvider === "api"
    ? String(providerConfig?.provider || r.embeddingApiProvider || "").trim().toLowerCase()
    : "";
  const embeddingApiProviderId = normalizedEmbeddingProvider === "api"
    ? String(providerConfig?.id || r.embeddingApiProviderId || "").trim()
    : "";
  const isApiProvider = normalizedEmbeddingProvider === "api";
  const resolvedModel = String(r.embeddingModel || providerConfig?.model || "").trim();
  const currentProviderLabel = isApiProvider
    ? toProviderDisplayLabel(providerConfig?.provider || embeddingApiProvider, providerConfig?.customName)
    : toCurrentEmbeddingProviderLabel(normalizedEmbeddingProvider);

  return {
    embeddingProvider: normalizedEmbeddingProvider,
    embeddingApiProvider,
    embeddingApiProviderId,
    embeddingsIndexBatchSize: r.embeddingsIndexBatchSize,
    embeddingsRetryMaxAttempts: r.embeddingsRetryMaxAttempts,
    embeddingsRetryBaseDelayMs: r.embeddingsRetryBaseDelayMs,
    embeddingVectorDimensions: r.embeddingVectorDimensions,
    embeddingModel: resolvedModel,
    embeddingMaxBatchSize: r.embeddingMaxBatchSize,
    embeddingCacheDir: r.embeddingCacheDir,
    embeddingAllowRemoteModels: r.embeddingAllowRemoteModels,
    embeddingQuantized: r.embeddingQuantized,
    semanticSearchTopKDefault: r.semanticSearchTopKDefault,
    semanticSearchMinScore: r.semanticSearchMinScore,
    ragMaxChunks: r.ragMaxChunks,
    ragChunkTokenBudget: r.ragChunkTokenBudget,
    currentEmbeddingModelLabel: toCurrentEmbeddingModelLabel({
      provider: normalizedEmbeddingProvider,
      providerLabel: currentProviderLabel,
      model: resolvedModel,
    }),
    currentEmbeddingProviderLabel: currentProviderLabel,
  };
}

export async function updateRetrievalPreferences(body: any) {
  const embeddingProviderRaw = asOptionalString(body?.embeddingProvider)?.toLowerCase();
  const embeddingProvider = EMBEDDING_PROVIDERS.includes(embeddingProviderRaw as EmbeddingProviderName)
    ? embeddingProviderRaw as EmbeddingProviderName
    : undefined;
  const embeddingApiProvider = asOptionalString(body?.embeddingApiProvider)?.toLowerCase();
  const embeddingApiProviderId = asOptionalString(body?.embeddingApiProviderId);
  const embeddingsIndexBatchSize = asOptionalNumber(body?.embeddingsIndexBatchSize);
  const embeddingsRetryMaxAttempts = asOptionalNumber(body?.embeddingsRetryMaxAttempts);
  const embeddingsRetryBaseDelayMs = asOptionalNumber(body?.embeddingsRetryBaseDelayMs);
  const embeddingVectorDimensions = asOptionalNumber(body?.embeddingVectorDimensions);
  const embeddingModel = asOptionalString(body?.embeddingModel);
  const embeddingMaxBatchSize = asOptionalNumber(body?.embeddingMaxBatchSize);
  const embeddingCacheDir = asOptionalString(body?.embeddingCacheDir);
  const embeddingAllowRemoteModels = asOptionalBoolean(body?.embeddingAllowRemoteModels);
  const embeddingQuantized = asOptionalBoolean(body?.embeddingQuantized);
  const semanticSearchTopKDefault = asOptionalNumber(body?.semanticSearchTopKDefault);
  const semanticSearchMinScore = asOptionalNumber(body?.semanticSearchMinScore);
  const ragMaxChunks = asOptionalNumber(body?.ragMaxChunks);
  const ragChunkTokenBudget = asOptionalNumber(body?.ragChunkTokenBudget);
  const errors: string[] = [];

  if (embeddingProviderRaw && !embeddingProvider) {
    errors.push(`embeddingProvider must be one of: ${EMBEDDING_PROVIDERS.join(", ")}`);
  }
  validateIntegerField("embeddingsIndexBatchSize", embeddingsIndexBatchSize, 1, 512, errors);
  validateIntegerField("embeddingsRetryMaxAttempts", embeddingsRetryMaxAttempts, 1, 20, errors);
  validateIntegerField("embeddingsRetryBaseDelayMs", embeddingsRetryBaseDelayMs, 10, 60_000, errors);
  validateIntegerField("embeddingVectorDimensions", embeddingVectorDimensions, 64, 4096, errors);
  validateIntegerField("embeddingMaxBatchSize", embeddingMaxBatchSize, 1, 512, errors);
  validateIntegerField("semanticSearchTopKDefault", semanticSearchTopKDefault, 1, 100, errors);
  if (semanticSearchMinScore !== undefined && (
    Number.isNaN(semanticSearchMinScore) || semanticSearchMinScore < 0 || semanticSearchMinScore > 1
  )) {
    errors.push("semanticSearchMinScore must be between 0 and 1");
  }
  validateIntegerField("ragMaxChunks", ragMaxChunks, 1, 100, errors);
  validateIntegerField("ragChunkTokenBudget", ragChunkTokenBudget, 64, 100_000, errors);
  if (embeddingModel !== undefined && !embeddingModel) {
    errors.push("embeddingModel cannot be empty");
  }
  if (errors.length > 0) {
    return { ok: false as const, status: 400, message: errors.join("; ") };
  }

  const runtime = getRuntimeConfig();
  const resolvedProvider = embeddingProvider || runtime.retrievalEmbedding.embeddingProvider;
  const isApiEmbeddingProvider = resolvedProvider === "api";
  const resolvedApiProviderConfig = isApiEmbeddingProvider
    ? await findApiEmbeddingProviderConfig({
        provider: embeddingApiProvider || runtime.retrievalEmbedding.embeddingApiProvider,
        providerId: embeddingApiProviderId || runtime.retrievalEmbedding.embeddingApiProviderId,
        model: embeddingModel || runtime.retrievalEmbedding.embeddingModel,
      })
    : null;
  if (isApiEmbeddingProvider && !resolvedApiProviderConfig) {
    return {
      ok: false as const,
      status: 400,
      message: "A saved provider connection is required for API-based embedding models.",
    };
  }

  const resolvedApiProvider = isApiEmbeddingProvider
    ? String(
      resolvedApiProviderConfig?.provider
      || embeddingApiProvider
      || runtime.retrievalEmbedding.embeddingApiProvider
      || "",
    ).trim().toLowerCase()
    : "";

  const runtimeUpdates: Record<string, unknown> = {};
  if (embeddingProvider !== undefined) runtimeUpdates.EMBEDDING_PROVIDER = embeddingProvider;
  if (isApiEmbeddingProvider) {
    runtimeUpdates.EMBEDDING_API_PROVIDER = resolvedApiProvider;
    runtimeUpdates.EMBEDDING_API_PROVIDER_ID = String(
      resolvedApiProviderConfig?.id
      || embeddingApiProviderId
      || runtime.retrievalEmbedding.embeddingApiProviderId
      || "",
    ).trim();
  } else {
    runtimeUpdates.EMBEDDING_API_PROVIDER = "";
    runtimeUpdates.EMBEDDING_API_PROVIDER_ID = "";
  }
  if (embeddingsIndexBatchSize !== undefined) runtimeUpdates.EMBEDDINGS_INDEX_BATCH_SIZE = embeddingsIndexBatchSize;
  if (embeddingsRetryMaxAttempts !== undefined) runtimeUpdates.EMBEDDINGS_RETRY_MAX_ATTEMPTS = embeddingsRetryMaxAttempts;
  if (embeddingsRetryBaseDelayMs !== undefined) runtimeUpdates.EMBEDDINGS_RETRY_BASE_DELAY_MS = embeddingsRetryBaseDelayMs;
  if (embeddingVectorDimensions !== undefined) runtimeUpdates.EMBEDDING_VECTOR_DIMENSIONS = embeddingVectorDimensions;
  if (embeddingMaxBatchSize !== undefined) runtimeUpdates.EMBEDDING_MAX_BATCH_SIZE = embeddingMaxBatchSize;
  if (embeddingCacheDir !== undefined) runtimeUpdates.EMBEDDING_CACHE_DIR = embeddingCacheDir;
  if (embeddingAllowRemoteModels !== undefined) runtimeUpdates.EMBEDDING_ALLOW_REMOTE_MODELS = embeddingAllowRemoteModels;
  if (embeddingQuantized !== undefined) runtimeUpdates.EMBEDDING_QUANTIZED = embeddingQuantized;
  if (semanticSearchTopKDefault !== undefined) runtimeUpdates.SEMANTIC_SEARCH_TOP_K_DEFAULT = semanticSearchTopKDefault;
  if (semanticSearchMinScore !== undefined) runtimeUpdates.SEMANTIC_SEARCH_MIN_SCORE = semanticSearchMinScore;
  if (ragMaxChunks !== undefined) runtimeUpdates.RAG_MAX_CHUNKS = ragMaxChunks;
  if (ragChunkTokenBudget !== undefined) runtimeUpdates.RAG_CHUNK_TOKEN_BUDGET = ragChunkTokenBudget;
  if (embeddingModel !== undefined) runtimeUpdates.EMBEDDING_MODEL = embeddingModel;

  if (Object.keys(runtimeUpdates).length > 0) {
    await updateRuntimeConfigFileAsync(runtimeUpdates);
    resetEmbeddingConfigCache();
  }

  if (isApiEmbeddingProvider && resolvedApiProviderConfig && embeddingModel !== undefined) {
    await db.update(providerConfigs)
      .set({ model: embeddingModel })
      .where(eq(providerConfigs.id, resolvedApiProviderConfig.id));
  }

  return { ok: true as const, view: await toRetrievalPreferencesView() };
}

export async function createProvider(input: {
  provider: string;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  customName?: string | null;
}) {
  const normalizedCustomName = typeof input.customName === "string" ? input.customName.trim().slice(0, 80) : "";
  await db.update(providerConfigs).set({ isDefault: false });
  const [newConfig] = await db.insert(providerConfigs).values({
    id: "prov_" + crypto.randomUUID(),
    provider: input.provider,
    customName: normalizedCustomName || null,
    model: input.model,
    apiKey: await encryptProviderApiKey(input.apiKey || null),
    baseUrl: input.baseUrl || null,
    isDefault: true,
  }).returning();
  invalidateModelDiscoveryCache();
  return await toProviderView(newConfig);
}

export async function activateProvider(id: string) {
  await db.update(providerConfigs).set({ isDefault: false });
  const [updatedConfig] = await db.update(providerConfigs)
    .set({ isDefault: true })
    .where(eq(providerConfigs.id, id))
    .returning();
  if (updatedConfig) invalidateModelDiscoveryCache(`provider:${id}`);
  return updatedConfig ? await toProviderView(updatedConfig) : null;
}

export async function updateProviderModel(id: string, model: string) {
  const [updatedConfig] = await db.update(providerConfigs)
    .set({ model })
    .where(eq(providerConfigs.id, id))
    .returning();
  if (updatedConfig) invalidateModelDiscoveryCache(`provider:${id}`);
  return updatedConfig ? await toProviderView(updatedConfig) : null;
}

export async function deleteProvider(id: string) {
  const [deleted] = await db.delete(providerConfigs)
    .where(eq(providerConfigs.id, id))
    .returning();
  if (deleted) invalidateModelDiscoveryCache(`provider:${id}`);
  return deleted ? await toProviderView(deleted) : null;
}
