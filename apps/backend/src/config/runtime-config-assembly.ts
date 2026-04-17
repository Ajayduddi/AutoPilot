/**
 * @fileoverview apps/backend/src/config/runtime-config-assembly.ts
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
import type {
  RuntimeApprovalMode,
  RuntimeConfig,
  RuntimeConfigFile,
} from "./runtime.config";
import {
  dirnamePath,
  joinPath,
  parseBoolean,
  parseNumber,
  parseString,
  parseStringList,
} from "./runtime-config-utils";

type BuildRuntimeConfigParams = {
  homeDir: string;
  configPath: string;
  fileCfg: RuntimeConfigFile;
  forceInteractiveQuestions: boolean;
  uploadDir: string;
  approvalMode: RuntimeApprovalMode;
  defaultTimezone: string;
  contextModelMaxRetrieval: Record<string, number>;
  allowedMimeTypes: string[];
  mcpServers: MCPClientOptions["servers"];
};

export function buildRuntimeValidationInputs(
  fileCfg: RuntimeConfigFile,
): Record<string, unknown> {
  return {
    ...fileCfg,
    DEFAULT_TIMEZONE: fileCfg.DEFAULT_TIMEZONE ?? process.env.DEFAULT_TIMEZONE,
    ALLOW_PRIVATE_MODEL_FETCH: fileCfg.ALLOW_PRIVATE_MODEL_FETCH ?? process.env.ALLOW_PRIVATE_MODEL_FETCH,
    MODEL_FETCH_TIMEOUT_MS: fileCfg.MODEL_FETCH_TIMEOUT_MS ?? process.env.MODEL_FETCH_TIMEOUT_MS,
    MAX_MODEL_FETCH_BYTES: fileCfg.MAX_MODEL_FETCH_BYTES ?? process.env.MAX_MODEL_FETCH_BYTES,
    OLLAMA_URL: fileCfg.OLLAMA_URL ?? process.env.OLLAMA_URL,
    CONTEXT_MODE_ENABLED: fileCfg.CONTEXT_MODE_ENABLED ?? process.env.CONTEXT_MODE_ENABLED,
    CONTEXT_MODE_DEBUG: fileCfg.CONTEXT_MODE_DEBUG ?? process.env.CONTEXT_MODE_DEBUG,
    CONTEXT_MODE_MAX_RETRIEVAL: fileCfg.CONTEXT_MODE_MAX_RETRIEVAL ?? process.env.CONTEXT_MODE_MAX_RETRIEVAL,
    CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON:
      fileCfg.CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON ?? process.env.CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON,
    CONTEXT_MODE_CONTENT_MAX_LEN: fileCfg.CONTEXT_MODE_CONTENT_MAX_LEN ?? process.env.CONTEXT_MODE_CONTENT_MAX_LEN,
    CONTEXT_MODE_SUMMARY_MAX_LEN: fileCfg.CONTEXT_MODE_SUMMARY_MAX_LEN ?? process.env.CONTEXT_MODE_SUMMARY_MAX_LEN,
    CONTEXT_MODE_TARGET_WINDOW_TOKENS:
      fileCfg.CONTEXT_MODE_TARGET_WINDOW_TOKENS ?? process.env.CONTEXT_MODE_TARGET_WINDOW_TOKENS,
    CONTEXT_MODE_HISTORY_BUDGET_TOKENS:
      fileCfg.CONTEXT_MODE_HISTORY_BUDGET_TOKENS ?? process.env.CONTEXT_MODE_HISTORY_BUDGET_TOKENS,
    CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS:
      fileCfg.CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS ?? process.env.CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS,
    CONTEXT_MODE_MAX_MESSAGE_TOKENS:
      fileCfg.CONTEXT_MODE_MAX_MESSAGE_TOKENS ?? process.env.CONTEXT_MODE_MAX_MESSAGE_TOKENS,
    CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS:
      fileCfg.CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS ?? process.env.CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS,
    CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS:
      fileCfg.CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS ?? process.env.CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS,
    CONTEXT_MODE_INDEX_WORKFLOW_RUNS:
      fileCfg.CONTEXT_MODE_INDEX_WORKFLOW_RUNS ?? process.env.CONTEXT_MODE_INDEX_WORKFLOW_RUNS,
    CONTEXT_MODE_INDEX_DECISIONS:
      fileCfg.CONTEXT_MODE_INDEX_DECISIONS ?? process.env.CONTEXT_MODE_INDEX_DECISIONS,
    CONTEXT_MODE_INDEX_THREAD_STATE:
      fileCfg.CONTEXT_MODE_INDEX_THREAD_STATE ?? process.env.CONTEXT_MODE_INDEX_THREAD_STATE,
    CONTEXT_MODE_TTL_DAYS: fileCfg.CONTEXT_MODE_TTL_DAYS ?? process.env.CONTEXT_MODE_TTL_DAYS,
    CONTEXT_MODE_CACHE_ANSWER: fileCfg.CONTEXT_MODE_CACHE_ANSWER ?? process.env.CONTEXT_MODE_CACHE_ANSWER,
    CONTEXT_MODE_CACHE_STALE_MINS: fileCfg.CONTEXT_MODE_CACHE_STALE_MINS ?? process.env.CONTEXT_MODE_CACHE_STALE_MINS,
    MAX_UPLOAD_MB: fileCfg.MAX_UPLOAD_MB ?? process.env.MAX_UPLOAD_MB,
    MAX_FILES_PER_MESSAGE: fileCfg.MAX_FILES_PER_MESSAGE ?? process.env.MAX_FILES_PER_MESSAGE,
    ALLOWED_MIME_TYPES: fileCfg.ALLOWED_MIME_TYPES ?? process.env.ALLOWED_MIME_TYPES,
    ATTACHMENT_PROCESS_TIMEOUT_MS: fileCfg.ATTACHMENT_PROCESS_TIMEOUT_MS ?? process.env.ATTACHMENT_PROCESS_TIMEOUT_MS,
    XLSX_MAX_COLS: fileCfg.XLSX_MAX_COLS ?? process.env.XLSX_MAX_COLS,
    XLSX_MAX_ROWS_RENDER_PER_SHEET:
      fileCfg.XLSX_MAX_ROWS_RENDER_PER_SHEET ?? process.env.XLSX_MAX_ROWS_RENDER_PER_SHEET,
    XLSX_MAX_ROWS_PARSE_PER_SHEET:
      fileCfg.XLSX_MAX_ROWS_PARSE_PER_SHEET ?? process.env.XLSX_MAX_ROWS_PARSE_PER_SHEET,
    AGENT_RUNTIME_MAX_STEPS: fileCfg.AGENT_RUNTIME_MAX_STEPS ?? process.env.AGENT_RUNTIME_MAX_STEPS,
    MASTRA_AGENT_MODEL: fileCfg.MASTRA_AGENT_MODEL ?? process.env.MASTRA_AGENT_MODEL,
    AGENT_MCP_ENABLED: fileCfg.AGENT_MCP_ENABLED ?? process.env.AGENT_MCP_ENABLED,
    AGENT_MCP_SERVERS_JSON: fileCfg.AGENT_MCP_SERVERS_JSON ?? process.env.AGENT_MCP_SERVERS_JSON,
    AGENT_MCP_TIMEOUT_MS: fileCfg.AGENT_MCP_TIMEOUT_MS ?? process.env.AGENT_MCP_TIMEOUT_MS,
    LLM_PARSE_INTENT_TIMEOUT_MS: fileCfg.LLM_PARSE_INTENT_TIMEOUT_MS ?? process.env.LLM_PARSE_INTENT_TIMEOUT_MS,
    LLM_GENERATE_REPLY_TIMEOUT_MS: fileCfg.LLM_GENERATE_REPLY_TIMEOUT_MS ?? process.env.LLM_GENERATE_REPLY_TIMEOUT_MS,
    LLM_STREAM_STALL_TIMEOUT_MS: fileCfg.LLM_STREAM_STALL_TIMEOUT_MS ?? process.env.LLM_STREAM_STALL_TIMEOUT_MS,
    WORKFLOW_CONTEXT_CACHE_TTL_MS:
      fileCfg.WORKFLOW_CONTEXT_CACHE_TTL_MS ?? process.env.WORKFLOW_CONTEXT_CACHE_TTL_MS,
    LLM_INTENT_WORKFLOW_SHORTLIST:
      fileCfg.LLM_INTENT_WORKFLOW_SHORTLIST ?? process.env.LLM_INTENT_WORKFLOW_SHORTLIST,
    LLM_REPLY_WORKFLOW_SHORTLIST:
      fileCfg.LLM_REPLY_WORKFLOW_SHORTLIST ?? process.env.LLM_REPLY_WORKFLOW_SHORTLIST,
    AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES:
      fileCfg.AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES ?? process.env.AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES,
    AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS:
      fileCfg.AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS ?? process.env.AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS,
    AUTO_ROUTER_DISCOVERY_TTL_MS:
      fileCfg.AUTO_ROUTER_DISCOVERY_TTL_MS ?? process.env.AUTO_ROUTER_DISCOVERY_TTL_MS,
    AUTO_ROUTER_DISCOVERY_TIMEOUT_MS:
      fileCfg.AUTO_ROUTER_DISCOVERY_TIMEOUT_MS ?? process.env.AUTO_ROUTER_DISCOVERY_TIMEOUT_MS,
    AUTO_ROUTER_MAX_MODELS_PER_PROVIDER:
      fileCfg.AUTO_ROUTER_MAX_MODELS_PER_PROVIDER ?? process.env.AUTO_ROUTER_MAX_MODELS_PER_PROVIDER,
    AUTO_ROUTER_MAX_CANDIDATES:
      fileCfg.AUTO_ROUTER_MAX_CANDIDATES ?? process.env.AUTO_ROUTER_MAX_CANDIDATES,
    AUTO_ROUTER_PREFERRED_REASONING_MODELS:
      fileCfg.AUTO_ROUTER_PREFERRED_REASONING_MODELS ?? process.env.AUTO_ROUTER_PREFERRED_REASONING_MODELS,
    ATTACHMENT_SCAN_MODE: fileCfg.ATTACHMENT_SCAN_MODE ?? process.env.ATTACHMENT_SCAN_MODE,
    ATTACHMENT_SCAN_FAIL_CLOSED: fileCfg.ATTACHMENT_SCAN_FAIL_CLOSED ?? process.env.ATTACHMENT_SCAN_FAIL_CLOSED,
    ATTACHMENT_SCAN_TIMEOUT_MS: fileCfg.ATTACHMENT_SCAN_TIMEOUT_MS ?? process.env.ATTACHMENT_SCAN_TIMEOUT_MS,
    ATTACHMENT_SCAN_HTTP_URL: fileCfg.ATTACHMENT_SCAN_HTTP_URL ?? process.env.ATTACHMENT_SCAN_HTTP_URL,
    ATTACHMENT_SCAN_HTTP_TOKEN: fileCfg.ATTACHMENT_SCAN_HTTP_TOKEN ?? process.env.ATTACHMENT_SCAN_HTTP_TOKEN,
    CLAMAV_HOST: fileCfg.CLAMAV_HOST ?? process.env.CLAMAV_HOST,
    CLAMAV_PORT: fileCfg.CLAMAV_PORT ?? process.env.CLAMAV_PORT,
    CALLBACK_BASE_URL: fileCfg.CALLBACK_BASE_URL ?? process.env.CALLBACK_BASE_URL,
    FRONTEND_ORIGIN: fileCfg.FRONTEND_ORIGIN ?? process.env.FRONTEND_ORIGIN,
    SESSION_TTL_DAYS: fileCfg.SESSION_TTL_DAYS ?? process.env.SESSION_TTL_DAYS,
    AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE:
      fileCfg.AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE ?? process.env.AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE,
    GOOGLE_CLIENT_ID: fileCfg.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: fileCfg.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: fileCfg.GOOGLE_REDIRECT_URI ?? process.env.GOOGLE_REDIRECT_URI,
    PROVIDER_API_KEY_ENCRYPTION_KEY:
      fileCfg.PROVIDER_API_KEY_ENCRYPTION_KEY ?? process.env.PROVIDER_API_KEY_ENCRYPTION_KEY,
    METRICS_PUSHGATEWAY_URL: fileCfg.METRICS_PUSHGATEWAY_URL ?? process.env.METRICS_PUSHGATEWAY_URL,
    METRICS_JOB_NAME: fileCfg.METRICS_JOB_NAME ?? process.env.METRICS_JOB_NAME,
    METRICS_INSTANCE_ID: fileCfg.METRICS_INSTANCE_ID ?? process.env.METRICS_INSTANCE_ID,
    METRICS_PUSH_INTERVAL_MS: fileCfg.METRICS_PUSH_INTERVAL_MS ?? process.env.METRICS_PUSH_INTERVAL_MS,
    METRICS_PUSH_TIMEOUT_MS: fileCfg.METRICS_PUSH_TIMEOUT_MS ?? process.env.METRICS_PUSH_TIMEOUT_MS,
    METRICS_SNAPSHOT_ENABLED: fileCfg.METRICS_SNAPSHOT_ENABLED ?? process.env.METRICS_SNAPSHOT_ENABLED,
    METRICS_SNAPSHOT_PATH: fileCfg.METRICS_SNAPSHOT_PATH ?? process.env.METRICS_SNAPSHOT_PATH,
    METRICS_ALLOW_PUBLIC: fileCfg.METRICS_ALLOW_PUBLIC ?? process.env.METRICS_ALLOW_PUBLIC,
    METRICS_AUTH_TOKEN: fileCfg.METRICS_AUTH_TOKEN ?? process.env.METRICS_AUTH_TOKEN,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    FEATURE_STRUCTURED_LOGGING: fileCfg.FEATURE_STRUCTURED_LOGGING ?? process.env.FEATURE_STRUCTURED_LOGGING,
    FEATURE_CROSS_ORIGIN_ISOLATION: fileCfg.FEATURE_CROSS_ORIGIN_ISOLATION ?? process.env.FEATURE_CROSS_ORIGIN_ISOLATION,
    EMBEDDING_PROVIDER: fileCfg.EMBEDDING_PROVIDER ?? process.env.EMBEDDING_PROVIDER,
    EMBEDDING_API_KEY: fileCfg.EMBEDDING_API_KEY ?? process.env.EMBEDDING_API_KEY,
    EMBEDDING_API_PROVIDER: fileCfg.EMBEDDING_API_PROVIDER ?? process.env.EMBEDDING_API_PROVIDER,
    EMBEDDING_API_PROVIDER_ID: fileCfg.EMBEDDING_API_PROVIDER_ID ?? process.env.EMBEDDING_API_PROVIDER_ID,
    EMBEDDINGS_ENABLED: fileCfg.EMBEDDINGS_ENABLED ?? process.env.EMBEDDINGS_ENABLED,
    EMBEDDINGS_DEBUG: fileCfg.EMBEDDINGS_DEBUG ?? process.env.EMBEDDINGS_DEBUG,
    EMBEDDINGS_INDEX_BATCH_SIZE: fileCfg.EMBEDDINGS_INDEX_BATCH_SIZE ?? process.env.EMBEDDINGS_INDEX_BATCH_SIZE,
    EMBEDDINGS_RETRY_MAX_ATTEMPTS:
      fileCfg.EMBEDDINGS_RETRY_MAX_ATTEMPTS ?? process.env.EMBEDDINGS_RETRY_MAX_ATTEMPTS,
    EMBEDDINGS_RETRY_BASE_DELAY_MS:
      fileCfg.EMBEDDINGS_RETRY_BASE_DELAY_MS ?? process.env.EMBEDDINGS_RETRY_BASE_DELAY_MS,
    EMBEDDING_VECTOR_DIMENSIONS: fileCfg.EMBEDDING_VECTOR_DIMENSIONS ?? process.env.EMBEDDING_VECTOR_DIMENSIONS,
    EMBEDDING_MODEL: fileCfg.EMBEDDING_MODEL ?? process.env.EMBEDDING_MODEL,
    EMBEDDING_MAX_BATCH_SIZE: fileCfg.EMBEDDING_MAX_BATCH_SIZE ?? process.env.EMBEDDING_MAX_BATCH_SIZE,
    EMBEDDING_CACHE_DIR: fileCfg.EMBEDDING_CACHE_DIR ?? process.env.EMBEDDING_CACHE_DIR,
    EMBEDDING_ALLOW_REMOTE_MODELS:
      fileCfg.EMBEDDING_ALLOW_REMOTE_MODELS ?? process.env.EMBEDDING_ALLOW_REMOTE_MODELS,
    EMBEDDING_QUANTIZED: fileCfg.EMBEDDING_QUANTIZED ?? process.env.EMBEDDING_QUANTIZED,
    SEMANTIC_SEARCH_TOP_K_DEFAULT:
      fileCfg.SEMANTIC_SEARCH_TOP_K_DEFAULT ?? process.env.SEMANTIC_SEARCH_TOP_K_DEFAULT,
    SEMANTIC_SEARCH_MIN_SCORE: fileCfg.SEMANTIC_SEARCH_MIN_SCORE ?? process.env.SEMANTIC_SEARCH_MIN_SCORE,
    RAG_MAX_CHUNKS: fileCfg.RAG_MAX_CHUNKS ?? process.env.RAG_MAX_CHUNKS,
    RAG_CHUNK_TOKEN_BUDGET: fileCfg.RAG_CHUNK_TOKEN_BUDGET ?? process.env.RAG_CHUNK_TOKEN_BUDGET,
    MISTRAL_API_KEY: fileCfg.MISTRAL_API_KEY ?? process.env.MISTRAL_API_KEY,
    MISTRAL_OCR_BASE_URL: fileCfg.MISTRAL_OCR_BASE_URL ?? process.env.MISTRAL_OCR_BASE_URL,
    MISTRAL_OCR_MODEL: fileCfg.MISTRAL_OCR_MODEL ?? process.env.MISTRAL_OCR_MODEL,
  };
}

export function buildRuntimeConfig({
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
}: BuildRuntimeConfigParams): RuntimeConfig {
  return {
    homeDir,
    configPath,
    forceInteractiveQuestions,
    uploadDir,
    approvalMode,
    defaultTimezone,
    modelFetch: {
      allowPrivate: parseBoolean(
        fileCfg.ALLOW_PRIVATE_MODEL_FETCH ?? process.env.ALLOW_PRIVATE_MODEL_FETCH,
        process.env.NODE_ENV === "production" ? false : true,
      ),
      timeoutMs: parseNumber(
        fileCfg.MODEL_FETCH_TIMEOUT_MS ?? process.env.MODEL_FETCH_TIMEOUT_MS,
        10_000,
      ),
      maxBytes: parseNumber(
        fileCfg.MAX_MODEL_FETCH_BYTES ?? process.env.MAX_MODEL_FETCH_BYTES,
        2 * 1024 * 1024,
      ),
    },
    ollamaUrl: parseString(
      fileCfg.OLLAMA_URL,
      process.env.OLLAMA_URL || "http://localhost:11434",
    ),
    contextMode: {
      enabled: parseBoolean(
        fileCfg.CONTEXT_MODE_ENABLED ?? process.env.CONTEXT_MODE_ENABLED,
        true,
      ),
      debug: parseBoolean(
        fileCfg.CONTEXT_MODE_DEBUG ?? process.env.CONTEXT_MODE_DEBUG,
        false,
      ),
      maxRetrieval: parseNumber(
        fileCfg.CONTEXT_MODE_MAX_RETRIEVAL ?? process.env.CONTEXT_MODE_MAX_RETRIEVAL,
        5,
      ),
      modelMaxRetrieval: contextModelMaxRetrieval,
      contentMaxLength: parseNumber(
        fileCfg.CONTEXT_MODE_CONTENT_MAX_LEN ?? process.env.CONTEXT_MODE_CONTENT_MAX_LEN,
        4000,
      ),
      summaryMaxLength: parseNumber(
        fileCfg.CONTEXT_MODE_SUMMARY_MAX_LEN ?? process.env.CONTEXT_MODE_SUMMARY_MAX_LEN,
        300,
      ),
      targetWindowTokens: parseNumber(
        fileCfg.CONTEXT_MODE_TARGET_WINDOW_TOKENS ?? process.env.CONTEXT_MODE_TARGET_WINDOW_TOKENS,
        250_000,
      ),
      historyBudgetTokens: parseNumber(
        fileCfg.CONTEXT_MODE_HISTORY_BUDGET_TOKENS ?? process.env.CONTEXT_MODE_HISTORY_BUDGET_TOKENS,
        160_000,
      ),
      retrievedContextBudgetTokens: parseNumber(
        fileCfg.CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS ?? process.env.CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS,
        70_000,
      ),
      maxMessageTokens: parseNumber(
        fileCfg.CONTEXT_MODE_MAX_MESSAGE_TOKENS ?? process.env.CONTEXT_MODE_MAX_MESSAGE_TOKENS,
        12_000,
      ),
      maxContextItemTokens: parseNumber(
        fileCfg.CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS ?? process.env.CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS,
        18_000,
      ),
      cacheDataBudgetTokens: parseNumber(
        fileCfg.CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS ?? process.env.CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS,
        48_000,
      ),
      index: {
        workflowRuns: parseBoolean(
          fileCfg.CONTEXT_MODE_INDEX_WORKFLOW_RUNS ?? process.env.CONTEXT_MODE_INDEX_WORKFLOW_RUNS,
          true,
        ),
        decisions: parseBoolean(
          fileCfg.CONTEXT_MODE_INDEX_DECISIONS ?? process.env.CONTEXT_MODE_INDEX_DECISIONS,
          true,
        ),
        threadState: parseBoolean(
          fileCfg.CONTEXT_MODE_INDEX_THREAD_STATE ?? process.env.CONTEXT_MODE_INDEX_THREAD_STATE,
          true,
        ),
      },
      ttlDays: parseNumber(
        fileCfg.CONTEXT_MODE_TTL_DAYS ?? process.env.CONTEXT_MODE_TTL_DAYS,
        30,
      ),
      cache: {
        enabled: parseBoolean(
          fileCfg.CONTEXT_MODE_CACHE_ANSWER ?? process.env.CONTEXT_MODE_CACHE_ANSWER,
          true,
        ),
        staleMins: parseNumber(
          fileCfg.CONTEXT_MODE_CACHE_STALE_MINS ?? process.env.CONTEXT_MODE_CACHE_STALE_MINS,
          15,
        ),
      },
    },
    attachments: {
      maxUploadMb: parseNumber(
        fileCfg.MAX_UPLOAD_MB ?? process.env.MAX_UPLOAD_MB,
        25,
      ),
      maxFilesPerMessage: parseNumber(
        fileCfg.MAX_FILES_PER_MESSAGE ?? process.env.MAX_FILES_PER_MESSAGE,
        6,
      ),
      allowedMimeTypes,
      processTimeoutMs: parseNumber(
        fileCfg.ATTACHMENT_PROCESS_TIMEOUT_MS ?? process.env.ATTACHMENT_PROCESS_TIMEOUT_MS,
        15_000,
      ),
    },
    extraction: {
      xlsxMaxCols: parseNumber(
        fileCfg.XLSX_MAX_COLS ?? process.env.XLSX_MAX_COLS,
        20,
      ),
      xlsxMaxRowsRenderPerSheet: parseNumber(
        fileCfg.XLSX_MAX_ROWS_RENDER_PER_SHEET ?? process.env.XLSX_MAX_ROWS_RENDER_PER_SHEET,
        200,
      ),
      xlsxMaxRowsParsePerSheet: Math.max(
        parseNumber(
          fileCfg.XLSX_MAX_ROWS_RENDER_PER_SHEET ?? process.env.XLSX_MAX_ROWS_RENDER_PER_SHEET,
          200,
        ),
        parseNumber(
          fileCfg.XLSX_MAX_ROWS_PARSE_PER_SHEET ?? process.env.XLSX_MAX_ROWS_PARSE_PER_SHEET,
          20_000,
        ),
      ),
    },
    agentRuntime: {
      maxSteps: parseNumber(
        fileCfg.AGENT_RUNTIME_MAX_STEPS ?? process.env.AGENT_RUNTIME_MAX_STEPS,
        6,
      ),
      mastraAgentModel: parseString(
        fileCfg.MASTRA_AGENT_MODEL,
        process.env.MASTRA_AGENT_MODEL || "",
      ),
      mcp: {
        enabled: parseBoolean(
          fileCfg.AGENT_MCP_ENABLED ?? process.env.AGENT_MCP_ENABLED,
          false,
        ),
        servers: mcpServers,
        timeoutMs: parseNumber(
          fileCfg.AGENT_MCP_TIMEOUT_MS ?? process.env.AGENT_MCP_TIMEOUT_MS,
          15_000,
        ),
      },
    },
    llm: {
      parseIntentTimeoutMs: parseNumber(
        fileCfg.LLM_PARSE_INTENT_TIMEOUT_MS ?? process.env.LLM_PARSE_INTENT_TIMEOUT_MS,
        12_000,
      ),
      generateReplyTimeoutMs: parseNumber(
        fileCfg.LLM_GENERATE_REPLY_TIMEOUT_MS ?? process.env.LLM_GENERATE_REPLY_TIMEOUT_MS,
        30_000,
      ),
      streamStallTimeoutMs: parseNumber(
        fileCfg.LLM_STREAM_STALL_TIMEOUT_MS ?? process.env.LLM_STREAM_STALL_TIMEOUT_MS,
        12_000,
      ),
      workflowContextCacheTtlMs: parseNumber(
        fileCfg.WORKFLOW_CONTEXT_CACHE_TTL_MS ?? process.env.WORKFLOW_CONTEXT_CACHE_TTL_MS,
        30_000,
      ),
      intentWorkflowShortlist: parseNumber(
        fileCfg.LLM_INTENT_WORKFLOW_SHORTLIST ?? process.env.LLM_INTENT_WORKFLOW_SHORTLIST,
        8,
      ),
      replyWorkflowShortlist: parseNumber(
        fileCfg.LLM_REPLY_WORKFLOW_SHORTLIST ?? process.env.LLM_REPLY_WORKFLOW_SHORTLIST,
        10,
      ),
    },
    autoRouter: {
      discoveryBreakerFailures: parseNumber(
        fileCfg.AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES ?? process.env.AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES,
        3,
      ),
      discoveryBreakerCooldownMs: parseNumber(
        fileCfg.AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS ?? process.env.AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS,
        45_000,
      ),
      discoveryTtlMs: parseNumber(
        fileCfg.AUTO_ROUTER_DISCOVERY_TTL_MS ?? process.env.AUTO_ROUTER_DISCOVERY_TTL_MS,
        600_000,
      ),
      discoveryTimeoutMs: parseNumber(
        fileCfg.AUTO_ROUTER_DISCOVERY_TIMEOUT_MS ?? process.env.AUTO_ROUTER_DISCOVERY_TIMEOUT_MS,
        4_500,
      ),
      maxModelsPerProvider: parseNumber(
        fileCfg.AUTO_ROUTER_MAX_MODELS_PER_PROVIDER ?? process.env.AUTO_ROUTER_MAX_MODELS_PER_PROVIDER,
        3,
      ),
      maxCandidates: parseNumber(
        fileCfg.AUTO_ROUTER_MAX_CANDIDATES ?? process.env.AUTO_ROUTER_MAX_CANDIDATES,
        8,
      ),
      preferredReasoningModels: parseStringList(
        fileCfg.AUTO_ROUTER_PREFERRED_REASONING_MODELS ?? process.env.AUTO_ROUTER_PREFERRED_REASONING_MODELS,
      ).length > 0
        ? parseStringList(
          fileCfg.AUTO_ROUTER_PREFERRED_REASONING_MODELS ?? process.env.AUTO_ROUTER_PREFERRED_REASONING_MODELS,
        )
        : ["glm-5", "mistral-large", "gpt-oss-120b", "minimax-2.7", "minimax-m2.7"],
    },
    attachmentScan: {
      mode: (() => {
        const mode = String(
          fileCfg.ATTACHMENT_SCAN_MODE ?? process.env.ATTACHMENT_SCAN_MODE ?? "off",
        ).trim().toLowerCase();
        return (mode === "clamav" || mode === "http" ? mode : "off") as "off" | "clamav" | "http";
      })(),
      failClosed: parseBoolean(
        fileCfg.ATTACHMENT_SCAN_FAIL_CLOSED ?? process.env.ATTACHMENT_SCAN_FAIL_CLOSED,
        false,
      ),
      timeoutMs: parseNumber(
        fileCfg.ATTACHMENT_SCAN_TIMEOUT_MS ?? process.env.ATTACHMENT_SCAN_TIMEOUT_MS,
        5_000,
      ),
      httpUrl: parseString(
        fileCfg.ATTACHMENT_SCAN_HTTP_URL,
        process.env.ATTACHMENT_SCAN_HTTP_URL || "",
      ),
      httpToken: parseString(
        fileCfg.ATTACHMENT_SCAN_HTTP_TOKEN,
        process.env.ATTACHMENT_SCAN_HTTP_TOKEN || "",
      ),
      clamavHost: parseString(
        fileCfg.CLAMAV_HOST,
        process.env.CLAMAV_HOST || "127.0.0.1",
      ),
      clamavPort: parseNumber(
        fileCfg.CLAMAV_PORT ?? process.env.CLAMAV_PORT,
        3310,
      ),
    },
    callbackBaseUrl: parseString(
      fileCfg.CALLBACK_BASE_URL,
      process.env.CALLBACK_BASE_URL || "http://localhost:3000",
    ).replace(/\/$/, ""),
    auth: {
      frontendOrigin: parseString(
        fileCfg.FRONTEND_ORIGIN,
        process.env.FRONTEND_ORIGIN || "http://localhost:5173",
      ).replace(/\/$/, ""),
      sessionTtlDays: parseNumber(
        fileCfg.SESSION_TTL_DAYS ?? process.env.SESSION_TTL_DAYS,
        14,
      ),
      revokeOtherSessionsOnPasswordChange: parseBoolean(
        fileCfg.AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE ?? process.env.AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE,
        true,
      ),
      google: {
        clientId: parseString(
          fileCfg.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_ID || "",
        ),
        clientSecret: parseString(
          fileCfg.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_CLIENT_SECRET || "",
        ),
        redirectUri: parseString(
          fileCfg.GOOGLE_REDIRECT_URI,
          process.env.GOOGLE_REDIRECT_URI || "",
        ),
      },
    },
    metricsExporter: {
      pushgatewayUrl: parseString(
        fileCfg.METRICS_PUSHGATEWAY_URL,
        process.env.METRICS_PUSHGATEWAY_URL || "",
      ),
      jobName: parseString(
        fileCfg.METRICS_JOB_NAME,
        process.env.METRICS_JOB_NAME || "autopilot-backend",
      ),
      instanceId: parseString(
        fileCfg.METRICS_INSTANCE_ID,
        process.env.METRICS_INSTANCE_ID || process.env.HOSTNAME || String(process.pid),
      ),
      pushIntervalMs: parseNumber(
        fileCfg.METRICS_PUSH_INTERVAL_MS ?? process.env.METRICS_PUSH_INTERVAL_MS,
        15_000,
      ),
      pushTimeoutMs: parseNumber(
        fileCfg.METRICS_PUSH_TIMEOUT_MS ?? process.env.METRICS_PUSH_TIMEOUT_MS,
        5_000,
      ),
      snapshotEnabled: parseBoolean(
        fileCfg.METRICS_SNAPSHOT_ENABLED ?? process.env.METRICS_SNAPSHOT_ENABLED,
        false,
      ),
      snapshotPath: parseString(
        fileCfg.METRICS_SNAPSHOT_PATH,
        process.env.METRICS_SNAPSHOT_PATH || joinPath(dirnamePath(configPath), "metrics.snapshot.json"),
      ),
      allowPublic: parseBoolean(
        fileCfg.METRICS_ALLOW_PUBLIC ?? process.env.METRICS_ALLOW_PUBLIC,
        false,
      ),
      authToken: parseString(
        fileCfg.METRICS_AUTH_TOKEN,
        process.env.METRICS_AUTH_TOKEN || "",
      ),
    },
    push: {
      vapidPublicKey: parseString(
        process.env.VAPID_PUBLIC_KEY,
        "",
      ),
      vapidPrivateKey: parseString(
        process.env.VAPID_PRIVATE_KEY,
        "",
      ),
      vapidSubject: parseString(
        process.env.VAPID_SUBJECT,
        "mailto:admin@autopilot.local",
      ),
    },
    features: {
      typedContracts: true,
      structuredLogging: parseBoolean(
        fileCfg.FEATURE_STRUCTURED_LOGGING ?? process.env.FEATURE_STRUCTURED_LOGGING,
        false,
      ),
      crossOriginIsolation: parseBoolean(
        fileCfg.FEATURE_CROSS_ORIGIN_ISOLATION ?? process.env.FEATURE_CROSS_ORIGIN_ISOLATION,
        false,
      ),
    },
    retrievalEmbedding: {
      embeddingProvider: (() => {
        const normalized = String(fileCfg.EMBEDDING_PROVIDER ?? process.env.EMBEDDING_PROVIDER ?? "api").trim().toLowerCase();
        if (normalized === "bge_local" || normalized === "minilm_local") return normalized;
        // Backward compat: treat legacy "gemini" config value as "api"
        return "api";
      })(),
      embeddingApiKey: parseString(
        fileCfg.EMBEDDING_API_KEY,
        process.env.EMBEDDING_API_KEY || "",
      ),
      embeddingApiProvider: parseString(
        fileCfg.EMBEDDING_API_PROVIDER,
        process.env.EMBEDDING_API_PROVIDER || "",
      ).toLowerCase(),
      embeddingApiProviderId: parseString(
        fileCfg.EMBEDDING_API_PROVIDER_ID,
        process.env.EMBEDDING_API_PROVIDER_ID || "",
      ),
      embeddingsEnabled: parseBoolean(
        fileCfg.EMBEDDINGS_ENABLED ?? process.env.EMBEDDINGS_ENABLED,
        true,
      ),
      embeddingsDebug: parseBoolean(
        fileCfg.EMBEDDINGS_DEBUG ?? process.env.EMBEDDINGS_DEBUG,
        false,
      ),
      embeddingsIndexBatchSize: parseNumber(
        fileCfg.EMBEDDINGS_INDEX_BATCH_SIZE ?? process.env.EMBEDDINGS_INDEX_BATCH_SIZE,
        32,
      ),
      embeddingsRetryMaxAttempts: parseNumber(
        fileCfg.EMBEDDINGS_RETRY_MAX_ATTEMPTS ?? process.env.EMBEDDINGS_RETRY_MAX_ATTEMPTS,
        3,
      ),
      embeddingsRetryBaseDelayMs: parseNumber(
        fileCfg.EMBEDDINGS_RETRY_BASE_DELAY_MS ?? process.env.EMBEDDINGS_RETRY_BASE_DELAY_MS,
        250,
      ),
      embeddingVectorDimensions: parseNumber(
        fileCfg.EMBEDDING_VECTOR_DIMENSIONS ?? process.env.EMBEDDING_VECTOR_DIMENSIONS,
        768,
      ),
      embeddingModel: parseString(
        fileCfg.EMBEDDING_MODEL,
        process.env.EMBEDDING_MODEL || "text-embedding-004",
      ),
      embeddingMaxBatchSize: parseNumber(
        fileCfg.EMBEDDING_MAX_BATCH_SIZE ?? process.env.EMBEDDING_MAX_BATCH_SIZE,
        32,
      ),
      embeddingCacheDir: parseString(
        fileCfg.EMBEDDING_CACHE_DIR,
        process.env.EMBEDDING_CACHE_DIR || "",
      ),
      embeddingAllowRemoteModels: parseBoolean(
        fileCfg.EMBEDDING_ALLOW_REMOTE_MODELS ?? process.env.EMBEDDING_ALLOW_REMOTE_MODELS,
        true,
      ),
      embeddingQuantized: parseBoolean(
        fileCfg.EMBEDDING_QUANTIZED ?? process.env.EMBEDDING_QUANTIZED,
        true,
      ),
      semanticSearchTopKDefault: parseNumber(
        fileCfg.SEMANTIC_SEARCH_TOP_K_DEFAULT ?? process.env.SEMANTIC_SEARCH_TOP_K_DEFAULT,
        8,
      ),
      semanticSearchMinScore: parseNumber(
        fileCfg.SEMANTIC_SEARCH_MIN_SCORE ?? process.env.SEMANTIC_SEARCH_MIN_SCORE,
        0.65,
      ),
      ragMaxChunks: parseNumber(
        fileCfg.RAG_MAX_CHUNKS ?? process.env.RAG_MAX_CHUNKS,
        8,
      ),
      ragChunkTokenBudget: parseNumber(
        fileCfg.RAG_CHUNK_TOKEN_BUDGET ?? process.env.RAG_CHUNK_TOKEN_BUDGET,
        2400,
      ),
    },
    mistralOcr: {
      apiKey: parseString(
        fileCfg.MISTRAL_API_KEY,
        process.env.MISTRAL_API_KEY || "",
      ),
      baseUrl: parseString(
        fileCfg.MISTRAL_OCR_BASE_URL,
        process.env.MISTRAL_OCR_BASE_URL || "https://api.mistral.ai/v1",
      ).replace(/\/$/, ""),
      model: parseString(
        fileCfg.MISTRAL_OCR_MODEL,
        process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest",
      ),
    },
    providerKeyCrypto: {
      encryptionKey: parseString(
        fileCfg.PROVIDER_API_KEY_ENCRYPTION_KEY,
        process.env.PROVIDER_API_KEY_ENCRYPTION_KEY || "",
      ),
    },
  };
}
