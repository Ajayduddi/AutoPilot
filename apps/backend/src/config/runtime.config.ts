/**
 * @fileoverview config/runtime.config.
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
import type { MCPClientOptions } from "@mastra/mcp";
import { z } from "zod";
import {
  ensureRuntimeConfigDirSync,
  primeRuntimeConfigText,
  readRuntimeConfigTextSync,
  resetRuntimeConfigIoCache,
  writeRuntimeConfigTextSync,
} from "./runtime-config-io";
import {
  type RuntimeValidationIssue,
  getHomeDirectory,
  joinPath,
  normalizeMcpServers,
  parseNumberMap,
  parseString,
  parseStringList,
  resolvePath,
  validateRuntimeRawInputs,
} from "./runtime-config-utils";
import {
  buildUpdatedRuntimeConfigFile,
  persistRuntimeConfigFile,
  persistRuntimeConfigFileAsync,
  type RuntimeConfigUpdates,
} from "./runtime-config-persistence";
import {
  buildRuntimeConfig,
  buildRuntimeValidationInputs,
} from "./runtime-config-assembly";

export type RuntimeConfigFile = {
  forceInteractiveQuestions?: boolean;
  uploadDir?: string;
  approvalMode?: RuntimeApprovalMode;
  DEFAULT_TIMEZONE?: string;
  ALLOW_PRIVATE_MODEL_FETCH?: boolean | string;
  MODEL_FETCH_TIMEOUT_MS?: number | string;
  MAX_MODEL_FETCH_BYTES?: number | string;
  OLLAMA_URL?: string;
  CONTEXT_MODE_ENABLED?: boolean | string;
  CONTEXT_MODE_DEBUG?: boolean | string;
  CONTEXT_MODE_MAX_RETRIEVAL?: number | string;
  CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON?: Record<string, unknown> | string;
  CONTEXT_MODE_CONTENT_MAX_LEN?: number | string;
  CONTEXT_MODE_SUMMARY_MAX_LEN?: number | string;
  CONTEXT_MODE_TARGET_WINDOW_TOKENS?: number | string;
  CONTEXT_MODE_HISTORY_BUDGET_TOKENS?: number | string;
  CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS?: number | string;
  CONTEXT_MODE_MAX_MESSAGE_TOKENS?: number | string;
  CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS?: number | string;
  CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS?: number | string;
  CONTEXT_MODE_INDEX_WORKFLOW_RUNS?: boolean | string;
  CONTEXT_MODE_INDEX_DECISIONS?: boolean | string;
  CONTEXT_MODE_INDEX_THREAD_STATE?: boolean | string;
  CONTEXT_MODE_TTL_DAYS?: number | string;
  CONTEXT_MODE_CACHE_ANSWER?: boolean | string;
  CONTEXT_MODE_CACHE_STALE_MINS?: number | string;
  MAX_UPLOAD_MB?: number | string;
  MAX_FILES_PER_MESSAGE?: number | string;
  ALLOWED_MIME_TYPES?: string[] | string;
  ATTACHMENT_PROCESS_TIMEOUT_MS?: number | string;
  XLSX_MAX_COLS?: number | string;
  XLSX_MAX_ROWS_RENDER_PER_SHEET?: number | string;
  XLSX_MAX_ROWS_PARSE_PER_SHEET?: number | string;
  AGENT_RUNTIME_MAX_STEPS?: number | string;
  MASTRA_AGENT_MODEL?: string;
  AGENT_MCP_ENABLED?: boolean | string;
  AGENT_MCP_SERVERS_JSON?: Record<string, unknown> | string;
  AGENT_MCP_TIMEOUT_MS?: number | string;
  LLM_PARSE_INTENT_TIMEOUT_MS?: number | string;
  LLM_GENERATE_REPLY_TIMEOUT_MS?: number | string;
  LLM_STREAM_STALL_TIMEOUT_MS?: number | string;
  WORKFLOW_CONTEXT_CACHE_TTL_MS?: number | string;
  LLM_INTENT_WORKFLOW_SHORTLIST?: number | string;
  LLM_REPLY_WORKFLOW_SHORTLIST?: number | string;
  AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES?: number | string;
  AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS?: number | string;
  AUTO_ROUTER_DISCOVERY_TTL_MS?: number | string;
  AUTO_ROUTER_DISCOVERY_TIMEOUT_MS?: number | string;
  AUTO_ROUTER_MAX_MODELS_PER_PROVIDER?: number | string;
  AUTO_ROUTER_MAX_CANDIDATES?: number | string;
  AUTO_ROUTER_PREFERRED_REASONING_MODELS?: string[] | string;
  ATTACHMENT_SCAN_MODE?: "off" | "clamav" | "http" | string;
  ATTACHMENT_SCAN_FAIL_CLOSED?: boolean | string;
  ATTACHMENT_SCAN_TIMEOUT_MS?: number | string;
  ATTACHMENT_SCAN_HTTP_URL?: string;
  ATTACHMENT_SCAN_HTTP_TOKEN?: string;
  CLAMAV_HOST?: string;
  CLAMAV_PORT?: number | string;
  CALLBACK_BASE_URL?: string;
  FRONTEND_ORIGIN?: string;
  SESSION_TTL_DAYS?: number | string;
  AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE?: boolean | string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  PROVIDER_API_KEY_ENCRYPTION_KEY?: string;
  METRICS_PUSHGATEWAY_URL?: string;
  METRICS_JOB_NAME?: string;
  METRICS_INSTANCE_ID?: string;
  METRICS_PUSH_INTERVAL_MS?: number | string;
  METRICS_PUSH_TIMEOUT_MS?: number | string;
  METRICS_SNAPSHOT_ENABLED?: boolean | string;
  METRICS_SNAPSHOT_PATH?: string;
  METRICS_ALLOW_PUBLIC?: boolean | string;
  METRICS_AUTH_TOKEN?: string;
  FEATURE_STRUCTURED_LOGGING?: boolean | string;
  FEATURE_CROSS_ORIGIN_ISOLATION?: boolean | string;
  EMBEDDING_PROVIDER?: string;
  EMBEDDING_API_KEY?: string;
  EMBEDDING_API_PROVIDER?: string;
  EMBEDDING_API_PROVIDER_ID?: string;
  EMBEDDINGS_ENABLED?: boolean | string;
  EMBEDDINGS_DEBUG?: boolean | string;
  EMBEDDINGS_INDEX_BATCH_SIZE?: number | string;
  EMBEDDINGS_RETRY_MAX_ATTEMPTS?: number | string;
  EMBEDDINGS_RETRY_BASE_DELAY_MS?: number | string;
  EMBEDDING_VECTOR_DIMENSIONS?: number | string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_MAX_BATCH_SIZE?: number | string;
  EMBEDDING_CACHE_DIR?: string;
  EMBEDDING_ALLOW_REMOTE_MODELS?: boolean | string;
  EMBEDDING_QUANTIZED?: boolean | string;
  SEMANTIC_SEARCH_TOP_K_DEFAULT?: number | string;
  SEMANTIC_SEARCH_MIN_SCORE?: number | string;
  RAG_MAX_CHUNKS?: number | string;
  RAG_CHUNK_TOKEN_BUDGET?: number | string;
  MISTRAL_API_KEY?: string;
  MISTRAL_OCR_BASE_URL?: string;
  MISTRAL_OCR_MODEL?: string;
};

/**
 * Runtime approval behavior for agent execution steps.
 *
 * - `default`: require explicit approval where configured.
 * - `auto`: allow auto-approval flows for eligible operations.
 */
export type RuntimeApprovalMode = "default" | "auto";

/**
 * Normalized runtime configuration consumed by backend modules.
 *
 * @remarks
 * This shape is produced by merging `~/.autopilot/config.json` with environment
 * variables, followed by strict schema validation.
 */
export type RuntimeConfig = {
  homeDir: string;
  configPath: string;
  forceInteractiveQuestions: boolean;
  uploadDir: string;
  approvalMode: RuntimeApprovalMode;
  defaultTimezone: string;
  modelFetch: {
    allowPrivate: boolean;
    timeoutMs: number;
    maxBytes: number;
  };
  ollamaUrl: string;
  contextMode: {
    enabled: boolean;
    debug: boolean;
    maxRetrieval: number;
    modelMaxRetrieval: Record<string, number>;
    contentMaxLength: number;
    summaryMaxLength: number;
    targetWindowTokens: number;
    historyBudgetTokens: number;
    retrievedContextBudgetTokens: number;
    maxMessageTokens: number;
    maxContextItemTokens: number;
    cacheDataBudgetTokens: number;
    index: {
      workflowRuns: boolean;
      decisions: boolean;
      threadState: boolean;
    };
    ttlDays: number;
    cache: {
      enabled: boolean;
      staleMins: number;
    };
  };
  attachments: {
    maxUploadMb: number;
    maxFilesPerMessage: number;
    allowedMimeTypes: string[];
    processTimeoutMs: number;
  };
  extraction: {
    xlsxMaxCols: number;
    xlsxMaxRowsRenderPerSheet: number;
    xlsxMaxRowsParsePerSheet: number;
  };
  agentRuntime: {
    maxSteps: number;
    mastraAgentModel: string;
    mcp: {
      enabled: boolean;
      servers: MCPClientOptions["servers"];
      timeoutMs: number;
    };
  };
  llm: {
    parseIntentTimeoutMs: number;
    generateReplyTimeoutMs: number;
    streamStallTimeoutMs: number;
    workflowContextCacheTtlMs: number;
    intentWorkflowShortlist: number;
    replyWorkflowShortlist: number;
  };
  autoRouter: {
    discoveryBreakerFailures: number;
    discoveryBreakerCooldownMs: number;
    discoveryTtlMs: number;
    discoveryTimeoutMs: number;
    maxModelsPerProvider: number;
    maxCandidates: number;
    preferredReasoningModels: string[];
  };
  attachmentScan: {
    mode: "off" | "clamav" | "http";
    failClosed: boolean;
    timeoutMs: number;
    httpUrl: string;
    httpToken: string;
    clamavHost: string;
    clamavPort: number;
  };
  callbackBaseUrl: string;
  auth: {
    frontendOrigin: string;
    sessionTtlDays: number;
    revokeOtherSessionsOnPasswordChange: boolean;
    google: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    };
  };
  metricsExporter: {
    pushgatewayUrl: string;
    jobName: string;
    instanceId: string;
    pushIntervalMs: number;
    pushTimeoutMs: number;
    snapshotEnabled: boolean;
    snapshotPath: string;
    allowPublic: boolean;
    authToken: string;
  };
  push: {
    vapidPublicKey: string;
    vapidPrivateKey: string;
    vapidSubject: string;
  };
  features: {
    typedContracts: boolean;
    structuredLogging: boolean;
    crossOriginIsolation: boolean;
  };
  retrievalEmbedding: {
    embeddingProvider: "api" | "bge_local" | "minilm_local";
    embeddingApiKey: string;
    embeddingApiProvider: string;
    embeddingApiProviderId: string;
    embeddingsEnabled: boolean;
    embeddingsDebug: boolean;
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
  };
  mistralOcr: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  providerKeyCrypto: {
    encryptionKey: string;
  };
};

let cached: RuntimeConfig | null = null;

/**
 * Error thrown when raw runtime inputs fail validation.
 *
 * @remarks
 * Includes structured issues to support CLI diagnostics and actionable fixes.
 */
export class RuntimeConfigValidationError extends Error {
  readonly issues: RuntimeValidationIssue[];

  constructor(issues: RuntimeValidationIssue[]) {
    super(
      [
        "Runtime configuration validation failed.",
        ...issues.map(
          (issue) =>
            `- ${issue.path}: expected ${issue.expected}; received ${JSON.stringify(issue.received)}. ${issue.fixHint}`,
        ),
      ].join("\n"),
    );
    this.name = "RuntimeConfigValidationError";
    this.issues = issues;
  }
}

/**
 * Runtime schema that validates and narrows normalized configuration output.
 */
const runtimeConfigSchema = z.object({
  homeDir: z.string().min(1),
  configPath: z.string().min(1),
  forceInteractiveQuestions: z.boolean(),
  uploadDir: z.string().min(1),
  approvalMode: z.enum(["default", "auto"]),
  defaultTimezone: z.string().min(1),
  modelFetch: z.object({
    allowPrivate: z.boolean(),
    timeoutMs: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
  }),
  ollamaUrl: z.string().url(),
  contextMode: z.object({
    enabled: z.boolean(),
    debug: z.boolean(),
    maxRetrieval: z.number().int().positive(),
    modelMaxRetrieval: z.record(z.string(), z.number().int().positive()),
    contentMaxLength: z.number().int().positive(),
    summaryMaxLength: z.number().int().positive(),
    targetWindowTokens: z.number().int().positive(),
    historyBudgetTokens: z.number().int().positive(),
    retrievedContextBudgetTokens: z.number().int().positive(),
    maxMessageTokens: z.number().int().positive(),
    maxContextItemTokens: z.number().int().positive(),
    cacheDataBudgetTokens: z.number().int().positive(),
    index: z.object({
      workflowRuns: z.boolean(),
      decisions: z.boolean(),
      threadState: z.boolean(),
    }),
    ttlDays: z.number().int().positive(),
    cache: z.object({
      enabled: z.boolean(),
      staleMins: z.number().int().nonnegative(),
    }),
  }),
  attachments: z.object({
    maxUploadMb: z.number().positive(),
    maxFilesPerMessage: z.number().int().positive(),
    allowedMimeTypes: z.array(z.string().min(1)),
    processTimeoutMs: z.number().int().positive(),
  }),
  extraction: z.object({
    xlsxMaxCols: z.number().int().positive(),
    xlsxMaxRowsRenderPerSheet: z.number().int().positive(),
    xlsxMaxRowsParsePerSheet: z.number().int().positive(),
  }),
  agentRuntime: z.object({
    maxSteps: z.number().int().positive(),
    mastraAgentModel: z.string(),
    mcp: z.object({
      enabled: z.boolean(),
      servers: z.record(z.string(), z.unknown()),
      timeoutMs: z.number().int().positive(),
    }),
  }),
  llm: z.object({
    parseIntentTimeoutMs: z.number().int().positive(),
    generateReplyTimeoutMs: z.number().int().positive(),
    streamStallTimeoutMs: z.number().int().positive(),
    workflowContextCacheTtlMs: z.number().int().positive(),
    intentWorkflowShortlist: z.number().int().positive(),
    replyWorkflowShortlist: z.number().int().positive(),
  }),
  autoRouter: z.object({
    discoveryBreakerFailures: z.number().int().positive(),
    discoveryBreakerCooldownMs: z.number().int().positive(),
    discoveryTtlMs: z.number().int().positive(),
    discoveryTimeoutMs: z.number().int().positive(),
    maxModelsPerProvider: z.number().int().positive(),
    maxCandidates: z.number().int().positive(),
    preferredReasoningModels: z.array(z.string().min(1)),
  }),
  attachmentScan: z.object({
    mode: z.enum(["off", "clamav", "http"]),
    failClosed: z.boolean(),
    timeoutMs: z.number().int().positive(),
    httpUrl: z.string(),
    httpToken: z.string(),
    clamavHost: z.string().min(1),
    clamavPort: z.number().int().positive(),
  }),
  callbackBaseUrl: z.string().url(),
  auth: z.object({
    frontendOrigin: z.string().url(),
    sessionTtlDays: z.number().int().positive(),
    revokeOtherSessionsOnPasswordChange: z.boolean(),
    google: z.object({
      clientId: z.string(),
      clientSecret: z.string(),
      redirectUri: z.string(),
    }),
  }),
  metricsExporter: z.object({
    pushgatewayUrl: z.string(),
    jobName: z.string().min(1),
    instanceId: z.string().min(1),
    pushIntervalMs: z.number().int().positive(),
    pushTimeoutMs: z.number().int().positive(),
    snapshotEnabled: z.boolean(),
    snapshotPath: z.string().min(1),
    allowPublic: z.boolean(),
    authToken: z.string(),
  }),
  push: z.object({
    vapidPublicKey: z.string(),
    vapidPrivateKey: z.string(),
    vapidSubject: z.string().min(1),
  }),
  features: z.object({
    typedContracts: z.boolean(),
    structuredLogging: z.boolean(),
    crossOriginIsolation: z.boolean(),
  }),
  retrievalEmbedding: z.object({
    embeddingProvider: z.enum(["api", "bge_local", "minilm_local"]),
    embeddingApiKey: z.string(),
    embeddingApiProvider: z.string(),
    embeddingApiProviderId: z.string(),
    embeddingsEnabled: z.boolean(),
    embeddingsDebug: z.boolean(),
    embeddingsIndexBatchSize: z.number().int().positive(),
    embeddingsRetryMaxAttempts: z.number().int().positive(),
    embeddingsRetryBaseDelayMs: z.number().int().positive(),
    embeddingVectorDimensions: z.number().int().positive(),
    embeddingModel: z.string().min(1),
    embeddingMaxBatchSize: z.number().int().positive(),
    embeddingCacheDir: z.string(),
    embeddingAllowRemoteModels: z.boolean(),
    embeddingQuantized: z.boolean(),
    semanticSearchTopKDefault: z.number().int().positive(),
    semanticSearchMinScore: z.number().min(0).max(1),
    ragMaxChunks: z.number().int().positive(),
    ragChunkTokenBudget: z.number().int().positive(),
  }),
  mistralOcr: z.object({
    apiKey: z.string(),
    baseUrl: z.string().url(),
    model: z.string().min(1),
  }),
  providerKeyCrypto: z.object({
    encryptionKey: z.string(),
  }),
});

const DEFAULT_RUNTIME_CONFIG_FILE: RuntimeConfigFile = {
  forceInteractiveQuestions: true,
  uploadDir: "./uploads",
  approvalMode: "default",
  DEFAULT_TIMEZONE: "UTC",
  ALLOW_PRIVATE_MODEL_FETCH: true,
  MODEL_FETCH_TIMEOUT_MS: 10000,
  MAX_MODEL_FETCH_BYTES: 2 * 1024 * 1024,
  OLLAMA_URL: "http://localhost:11434",
  CONTEXT_MODE_ENABLED: true,
  CONTEXT_MODE_DEBUG: false,
  CONTEXT_MODE_MAX_RETRIEVAL: 5,
  CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON: {},
  CONTEXT_MODE_CONTENT_MAX_LEN: 4000,
  CONTEXT_MODE_SUMMARY_MAX_LEN: 300,
  CONTEXT_MODE_TARGET_WINDOW_TOKENS: 250000,
  CONTEXT_MODE_HISTORY_BUDGET_TOKENS: 160000,
  CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS: 70000,
  CONTEXT_MODE_MAX_MESSAGE_TOKENS: 12000,
  CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS: 18000,
  CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS: 48000,
  CONTEXT_MODE_INDEX_WORKFLOW_RUNS: true,
  CONTEXT_MODE_INDEX_DECISIONS: true,
  CONTEXT_MODE_INDEX_THREAD_STATE: true,
  CONTEXT_MODE_TTL_DAYS: 30,
  CONTEXT_MODE_CACHE_ANSWER: true,
  CONTEXT_MODE_CACHE_STALE_MINS: 15,
  MAX_UPLOAD_MB: 25,
  MAX_FILES_PER_MESSAGE: 6,
  ALLOWED_MIME_TYPES: [
    "image/*",
    "audio/*",
    "text/*",
    "application/json",
    "application/xml",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ATTACHMENT_PROCESS_TIMEOUT_MS: 15000,
  XLSX_MAX_COLS: 20,
  XLSX_MAX_ROWS_RENDER_PER_SHEET: 200,
  XLSX_MAX_ROWS_PARSE_PER_SHEET: 20000,
  AGENT_RUNTIME_MAX_STEPS: 6,
  MASTRA_AGENT_MODEL: "",
  AGENT_MCP_ENABLED: false,
  AGENT_MCP_SERVERS_JSON: {},
  AGENT_MCP_TIMEOUT_MS: 15000,
  LLM_PARSE_INTENT_TIMEOUT_MS: 12000,
  LLM_GENERATE_REPLY_TIMEOUT_MS: 30000,
  LLM_STREAM_STALL_TIMEOUT_MS: 12000,
  WORKFLOW_CONTEXT_CACHE_TTL_MS: 30000,
  LLM_INTENT_WORKFLOW_SHORTLIST: 8,
  LLM_REPLY_WORKFLOW_SHORTLIST: 10,
  AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES: 3,
  AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS: 45000,
  AUTO_ROUTER_DISCOVERY_TTL_MS: 600000,
  AUTO_ROUTER_DISCOVERY_TIMEOUT_MS: 4500,
  AUTO_ROUTER_MAX_MODELS_PER_PROVIDER: 3,
  AUTO_ROUTER_MAX_CANDIDATES: 8,
  AUTO_ROUTER_PREFERRED_REASONING_MODELS: [
    "glm-5",
    "mistral-large",
    "gpt-oss-120b",
    "minimax-m2.7",
  ],
  ATTACHMENT_SCAN_MODE: "off",
  ATTACHMENT_SCAN_FAIL_CLOSED: false,
  ATTACHMENT_SCAN_TIMEOUT_MS: 5000,
  METRICS_PUSHGATEWAY_URL: "",
  METRICS_JOB_NAME: "autopilot-backend",
  METRICS_INSTANCE_ID: "",
  METRICS_PUSH_INTERVAL_MS: 15000,
  METRICS_PUSH_TIMEOUT_MS: 5000,
  METRICS_SNAPSHOT_ENABLED: false,
  METRICS_SNAPSHOT_PATH: "",
  METRICS_ALLOW_PUBLIC: false,
  METRICS_AUTH_TOKEN: "",
  EMBEDDING_PROVIDER: "api",
  EMBEDDING_API_KEY: "",
  EMBEDDING_API_PROVIDER: "",
  EMBEDDING_API_PROVIDER_ID: "",
  EMBEDDINGS_ENABLED: true,
  EMBEDDINGS_DEBUG: false,
  EMBEDDINGS_INDEX_BATCH_SIZE: 32,
  EMBEDDINGS_RETRY_MAX_ATTEMPTS: 3,
  EMBEDDINGS_RETRY_BASE_DELAY_MS: 250,
  EMBEDDING_VECTOR_DIMENSIONS: 768,
  EMBEDDING_MODEL: "text-embedding-004",
  EMBEDDING_MAX_BATCH_SIZE: 32,
  EMBEDDING_CACHE_DIR: "",
  EMBEDDING_ALLOW_REMOTE_MODELS: true,
  EMBEDDING_QUANTIZED: true,
  SEMANTIC_SEARCH_TOP_K_DEFAULT: 8,
  SEMANTIC_SEARCH_MIN_SCORE: 0.65,
  RAG_MAX_CHUNKS: 8,
  RAG_CHUNK_TOKEN_BUDGET: 2400,
  MISTRAL_OCR_BASE_URL: "https://api.mistral.ai/v1",
  MISTRAL_OCR_MODEL: "mistral-ocr-latest",
};

function ensureRuntimeConfigFileExists(homeDir: string, configPath: string): void {
  const existing = readRuntimeConfigTextSync(configPath);
  if (existing !== null) return;

  ensureRuntimeConfigDirSync(homeDir);
  writeRuntimeConfigTextSync(configPath, `${JSON.stringify(DEFAULT_RUNTIME_CONFIG_FILE, null, 2)}\n`);
}

/**
 * Reads and parses the optional runtime JSON config file.
 *
 * @returns Parsed config object, or an empty object when no config file exists.
 * @throws {RuntimeConfigValidationError} When the file cannot be read or parsed.
 */
function readConfigFile(configPath: string): RuntimeConfigFile {
  try {
    const raw = readRuntimeConfigTextSync(configPath);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as RuntimeConfigFile;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RuntimeConfigValidationError([
      {
        path: "configPath",
        expected: "readable JSON object",
        received: configPath,
        fixHint: `Fix or remove invalid config file at ${configPath}. Parse/read error: ${message}`,
      },
    ]);
  }
}

/**
 * Parses runtime approval mode, falling back to the provided default.
 */
function parseApprovalMode(value: unknown, fallback: RuntimeApprovalMode): RuntimeApprovalMode {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "default") return "default";
  return fallback;
}

/**
 * Loads, validates, and caches backend runtime configuration.
 */
function _getRuntimeConfig(): RuntimeConfig {
  if (cached) return cached;

  const homeDir = getHomeDirectory();
  const configPath = joinPath(homeDir, "config.json");
  ensureRuntimeConfigFileExists(homeDir, configPath);
  const fileCfg = readConfigFile(configPath);

  const fileForce = typeof fileCfg.forceInteractiveQuestions === "boolean"
    ? fileCfg.forceInteractiveQuestions
    : undefined;
  const forceInteractiveQuestions = fileForce ?? true;
  const approvalMode = parseApprovalMode(fileCfg.approvalMode, "default");

  const fileUploadDir = typeof fileCfg.uploadDir === "string" && fileCfg.uploadDir.trim()
    ? fileCfg.uploadDir.trim()
    : "";
  const uploadDir = resolvePath(fileUploadDir || joinPath(homeDir, "uploads"));
  const defaultTimezone = parseString(fileCfg.DEFAULT_TIMEZONE, process.env.DEFAULT_TIMEZONE || "UTC");
  const contextModelMaxRetrieval = parseNumberMap(
    fileCfg.CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON ?? process.env.CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON,
  );
  const allowedMimeTypes = parseStringList(
    fileCfg.ALLOWED_MIME_TYPES ?? process.env.ALLOWED_MIME_TYPES,
  );
  const mcpServers = normalizeMcpServers(
    fileCfg.AGENT_MCP_SERVERS_JSON ?? process.env.AGENT_MCP_SERVERS_JSON,
  );
  const validationIssues = validateRuntimeRawInputs(buildRuntimeValidationInputs(fileCfg));
  if (validationIssues.length > 0) {
    throw new RuntimeConfigValidationError(validationIssues);
  }

  cached = buildRuntimeConfig({
    homeDir,
    configPath,
    fileCfg,
    forceInteractiveQuestions,
    uploadDir,
    approvalMode,
    defaultTimezone,
    contextModelMaxRetrieval,
    allowedMimeTypes,
    mcpServers,
  });
  const parsed = runtimeConfigSchema.safeParse(cached);
  if (!parsed.success) {
    const issues: RuntimeValidationIssue[] = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      expected: issue.message,
      received: issue.input,
      fixHint: "Check config.json and environment variables for this field.",
    }));
    throw new RuntimeConfigValidationError(issues);
  }
  return cached;
}

/**
 * Returns whether interactive follow-up questions are enforced.
 *
 * @remarks
 * This helper is used by orchestration layers to decide whether the assistant
 * should emit follow-up question blocks instead of proceeding automatically.
 *
 * @returns `true` when interactive questioning is required by runtime policy.
 * @throws {@link RuntimeConfigValidationError} When runtime configuration fails
 * validation during lazy loading.
 *
 * @example
 * ```ts
 * if (isInteractiveQuestionEnforced()) {
 *   // Render interactive options in chat UI.
 * }
 * ```
 */
export function isInteractiveQuestionEnforced(): boolean {
  return getRuntimeConfig().forceInteractiveQuestions;
}

/**
 * Clears cached runtime config so the next read reloads from disk/env.
 */
function _resetRuntimeConfigCache(): void {
  cached = null;
  resetRuntimeConfigIoCache();
}

/**
 * Persists selected runtime preferences to the config file and reloads cache.
 */
function _updateRuntimeConfigFile(
  updates: RuntimeConfigUpdates,
): RuntimeConfig {
  const current = _getRuntimeConfig();
  const next = buildUpdatedRuntimeConfigFile(current, updates);
  persistRuntimeConfigFile(current, next);
  _resetRuntimeConfigCache();
  return _getRuntimeConfig();
}

async function _updateRuntimeConfigFileAsync(
  updates: RuntimeConfigUpdates,
): Promise<RuntimeConfig> {
  const current = _getRuntimeConfig();
  const next = buildUpdatedRuntimeConfigFile(current, updates);
  await persistRuntimeConfigFileAsync(current, next);
  _resetRuntimeConfigCache();
  return _getRuntimeConfig();
}

async function _primeRuntimeConfigCache(): Promise<RuntimeConfig> {
  const homeDir = getHomeDirectory();
  const configPath = joinPath(homeDir, "config.json");
  await primeRuntimeConfigText(configPath);
  cached = null;
  return _getRuntimeConfig();
}

/**
 * RuntimeConfigManager provides a mockable interface for runtime configuration.
 *
 * @remarks
 * Tests should use this object instead of directly importing wrapper functions
 * so behavior can be replaced with deterministic fixtures.
 *
 * @example
 * ```ts
 * const config = RuntimeConfigManager.getRuntimeConfig();
 * const updated = RuntimeConfigManager.updateRuntimeConfigFile({
 *   forceInteractiveQuestions: false,
 * });
 * ```
 */
export const RuntimeConfigManager = {
  getRuntimeConfig: _getRuntimeConfig,
  updateRuntimeConfigFile: _updateRuntimeConfigFile,
  updateRuntimeConfigFileAsync: _updateRuntimeConfigFileAsync,
  resetRuntimeConfigCache: _resetRuntimeConfigCache,
  primeRuntimeConfigCache: _primeRuntimeConfigCache,
};

/**
 * Returns the current normalized runtime configuration.
 *
 * @returns Fully merged and validated runtime config.
 * @throws {@link RuntimeConfigValidationError} When file/env inputs are invalid.
 *
 * @example
 * ```ts
 * const config = getRuntimeConfig();
 * console.log(config.auth.frontendOrigin);
 * ```
 */
export const getRuntimeConfig = () => RuntimeConfigManager.getRuntimeConfig();

/**
 * Persists selected runtime updates and returns refreshed configuration.
 *
 * @param updates - Partial runtime fields to update in config.json.
 * @returns Updated runtime config after persistence and cache refresh.
 * @throws {@link RuntimeConfigValidationError} When updated values violate
 * runtime validation constraints.
 *
 * @example
 * ```ts
 * const next = updateRuntimeConfigFile({
 *   forceInteractiveQuestions: true,
 * });
 * ```
 */
export const updateRuntimeConfigFile = (updates: any) => RuntimeConfigManager.updateRuntimeConfigFile(updates);

/**
 * Asynchronously persists runtime updates and returns refreshed configuration.
 *
 * @param updates - Partial runtime fields to update in config.json.
 * @returns Promise resolving to updated runtime config.
 * @throws {@link RuntimeConfigValidationError} When updated values violate
 * runtime validation constraints.
 *
 * @example
 * ```ts
 * const next = await updateRuntimeConfigFileAsync({
 *   forceInteractiveQuestions: false,
 * });
 * ```
 */
export const updateRuntimeConfigFileAsync = (updates: any) => RuntimeConfigManager.updateRuntimeConfigFileAsync(updates);

/**
 * Clears all runtime configuration caches.
 *
 * @remarks
 * The next call to runtime getters will reread config file content and
 * environment variables.
 *
 * @example
 * ```ts
 * resetRuntimeConfigCache();
 * const fresh = getRuntimeConfig();
 * ```
 */
export const resetRuntimeConfigCache = () => RuntimeConfigManager.resetRuntimeConfigCache();

/**
 * Preloads runtime config file text and refreshes the runtime cache.
 *
 * @returns Promise resolving to fresh runtime config.
 * @throws {@link RuntimeConfigValidationError} When loaded values are invalid.
 *
 * @example
 * ```ts
 * const config = await primeRuntimeConfigCache();
 * ```
 */
export const primeRuntimeConfigCache = () => RuntimeConfigManager.primeRuntimeConfigCache();
