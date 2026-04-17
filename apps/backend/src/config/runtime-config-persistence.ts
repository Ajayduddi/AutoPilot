/**
 * @fileoverview apps/backend/src/config/runtime-config-persistence.ts
 *
 * High-level purpose:
 * Runtime configuration contracts, loading, and normalization for backend execution.
 *
 * Key Features (and trade-offs):
 * - Validates and shapes environment/runtime config values.
 * - Provides typed accessors for production-safe settings.
 * - Supports deterministic configuration behavior across environments.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add new settings in centralized config contracts.
 * 3. Avoid scattering env access outside config modules.
 * 4. Typecheck and config tests should validate changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import {
  ensureRuntimeConfigDir,
  ensureRuntimeConfigDirSync,
  readRuntimeConfigTextSync,
  writeRuntimeConfigText,
  writeRuntimeConfigTextSync,
} from "./runtime-config-io";
import type { RuntimeConfig, RuntimeConfigFile } from "./runtime.config";

export type RuntimeConfigMutableKeys =
  | "approvalMode"
  | "forceInteractiveQuestions"
  | "uploadDir"
  | "CALLBACK_BASE_URL"
  | "FRONTEND_ORIGIN"
  | "SESSION_TTL_DAYS"
  | "AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE"
  | "EMBEDDING_PROVIDER"
  | "EMBEDDING_API_PROVIDER"
  | "EMBEDDING_API_PROVIDER_ID"
  | "EMBEDDINGS_ENABLED"
  | "EMBEDDINGS_DEBUG"
  | "EMBEDDINGS_INDEX_BATCH_SIZE"
  | "EMBEDDINGS_RETRY_MAX_ATTEMPTS"
  | "EMBEDDINGS_RETRY_BASE_DELAY_MS"
  | "EMBEDDING_VECTOR_DIMENSIONS"
  | "EMBEDDING_MODEL"
  | "EMBEDDING_MAX_BATCH_SIZE"
  | "EMBEDDING_CACHE_DIR"
  | "EMBEDDING_ALLOW_REMOTE_MODELS"
  | "EMBEDDING_QUANTIZED"
  | "SEMANTIC_SEARCH_TOP_K_DEFAULT"
  | "SEMANTIC_SEARCH_MIN_SCORE"
  | "RAG_MAX_CHUNKS"
  | "RAG_CHUNK_TOKEN_BUDGET";

export type RuntimeConfigUpdates = Partial<Pick<RuntimeConfigFile, RuntimeConfigMutableKeys>>;

function readConfigFile(configPath: string): RuntimeConfigFile {
  const raw = readRuntimeConfigTextSync(configPath);
  if (raw === null) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as RuntimeConfigFile;
}

export function buildUpdatedRuntimeConfigFile(
  current: RuntimeConfig,
  updates: RuntimeConfigUpdates,
): RuntimeConfigFile {
  const existing = readConfigFile(current.configPath);
  return {
    ...existing,
    ...updates,
  };
}

export function persistRuntimeConfigFile(
  current: RuntimeConfig,
  next: RuntimeConfigFile,
): void {
  ensureRuntimeConfigDirSync(current.homeDir);
  writeRuntimeConfigTextSync(current.configPath, `${JSON.stringify(next, null, 2)}\n`);
}

export async function persistRuntimeConfigFileAsync(
  current: RuntimeConfig,
  next: RuntimeConfigFile,
): Promise<void> {
  await ensureRuntimeConfigDir(current.homeDir);
  await writeRuntimeConfigText(current.configPath, `${JSON.stringify(next, null, 2)}\n`);
}
