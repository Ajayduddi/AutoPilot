/**
 * @fileoverview config/runtime.config.
 *
 * Runtime configuration loading, validation, and feature/runtime tuning controls.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { MCPClientOptions } from "@mastra/mcp";
import { z } from "zod";

type RuntimeConfigFile = {
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
  AGENT_RUNTIME_MAX_STEPS?: number | string;
  MASTRA_AGENT_MODEL?: string;
  AGENT_MCP_ENABLED?: boolean | string;
  AGENT_MCP_SERVERS_JSON?: Record<string, unknown> | string;
  AGENT_MCP_TIMEOUT_MS?: number | string;
  LLM_PARSE_INTENT_TIMEOUT_MS?: number | string;
  LLM_GENERATE_REPLY_TIMEOUT_MS?: number | string;
  LLM_STREAM_STALL_TIMEOUT_MS?: number | string;
  AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES?: number | string;
  AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS?: number | string;
  ATTACHMENT_SCAN_MODE?: "off" | "clamav" | "http" | string;
  ATTACHMENT_SCAN_FAIL_CLOSED?: boolean | string;
  ATTACHMENT_SCAN_TIMEOUT_MS?: number | string;
  METRICS_PUSHGATEWAY_URL?: string;
  METRICS_JOB_NAME?: string;
  METRICS_INSTANCE_ID?: string;
  METRICS_PUSH_INTERVAL_MS?: number | string;
  METRICS_PUSH_TIMEOUT_MS?: number | string;
  METRICS_SNAPSHOT_PATH?: string;
  FEATURE_TYPED_CONTRACTS?: boolean | string;
  FEATURE_STRUCTURED_LOGGING?: boolean | string;
  FEATURE_CROSS_ORIGIN_ISOLATION?: boolean | string;
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
  };
  autoRouter: {
        discoveryBreakerFailures: number;
        discoveryBreakerCooldownMs: number;
  };
  attachmentScan: {
        mode: "off" | "clamav" | "http";
        failClosed: boolean;
        timeoutMs: number;
  };
  metricsExporter: {
        pushgatewayUrl: string;
        jobName: string;
        instanceId: string;
        pushIntervalMs: number;
        pushTimeoutMs: number;
        snapshotPath: string;
  };
  features: {
        typedContracts: boolean;
        structuredLogging: boolean;
        crossOriginIsolation: boolean;
  };
};
let cached: RuntimeConfig | null = null;

type RuntimeValidationIssue = {
  /**
   * Dot-path or env key that failed validation.
   */
  path: string;
  /**
   * Human-readable expected value/type.
   */
  expected: string;
  /**
   * Raw value that was actually received.
   */
  received: unknown;
  /**
   * Suggested remediation shown to operators.
   */
  fixHint: string;
};

/**
 * Error thrown when raw runtime inputs fail validation.
 *
 * @remarks
 * Includes structured issues to support CLI diagnostics and actionable fixes.
 */
export class RuntimeConfigValidationError extends Error {
  /**
  * Structured validation issues used by callers for diagnostics.
   */
  readonly issues: RuntimeValidationIssue[];
  /**
  * Builds a readable multi-line error message from validation issues.
   */
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
  }),
  autoRouter: z.object({
    discoveryBreakerFailures: z.number().int().positive(),
    discoveryBreakerCooldownMs: z.number().int().positive(),
  }),
  attachmentScan: z.object({
    mode: z.enum(["off", "clamav", "http"]),
    failClosed: z.boolean(),
    timeoutMs: z.number().int().positive(),
  }),
  metricsExporter: z.object({
    pushgatewayUrl: z.string(),
    jobName: z.string().min(1),
    instanceId: z.string().min(1),
    pushIntervalMs: z.number().int().positive(),
    pushTimeoutMs: z.number().int().positive(),
    snapshotPath: z.string().min(1),
  }),
  features: z.object({
    typedContracts: z.boolean(),
    structuredLogging: z.boolean(),
    crossOriginIsolation: z.boolean(),
  }),
});

/**
 * Reads and parses the optional runtime JSON config file.
 *
 * @returns Parsed config object, or an empty object when no config file exists.
 * @throws {RuntimeConfigValidationError} When the file cannot be read or parsed.
 */
function readConfigFile(configPath: string): RuntimeConfigFile {
  try {
    if (!fs.existsSync(configPath)) return {};
        const raw = fs.readFileSync(configPath, "utf8");
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
 * Coerces boolean-like inputs (`true`, `1`, `yes`, etc.) with a fallback.
 */
function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

/**
 * Checks whether a value can be interpreted as a supported boolean token.
 */
function isBooleanLike(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on", "0", "false", "no", "off"].includes(normalized);
}

/**
 * Checks whether a value can be safely coerced to a finite number.
 */
function isNumberLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    if (!value.trim()) return false;
    return Number.isFinite(Number(value));
  }
  return false;
}

/**
 * Coerces a value into a finite number, otherwise returning the fallback.
 */
function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Trims string inputs and returns a fallback when empty or non-string.
 */
function parseString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
  return trimmed || fallback;
}

/**
 * Parses either a CSV string or string array into a normalized lowercase list.
 */
function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

/**
 * Parses a key-number map from an object or JSON string and filters invalid entries.
 */
function parseNumberMap(value: unknown): Record<string, number> {
    const source = typeof value === "string" && value.trim()
    ? safeJsonParse(value)
    : value;
  if (!source || typeof source !== "object") return {};

    const entries = Object.entries(source as Record<string, unknown>);
    const out: Record<string, number> = {};
  for (const [key, rawValue] of entries) {
        const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) continue;
        const parsedValue = parseNumber(rawValue, Number.NaN);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) continue;
    out[normalizedKey] = parsedValue;
  }
  return out;
}

/**
 * Parses JSON safely and returns `null` instead of throwing.
 */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Validates unparsed raw env/config inputs before coercion.
 *
 * @returns List of actionable validation issues; empty when inputs are acceptable.
 */
function validateRuntimeRawInputs(inputs: Record<string, unknown>): RuntimeValidationIssue[] {
    const issues: RuntimeValidationIssue[] = [];
    const boolKeys = [
    "CONTEXT_MODE_ENABLED",
    "CONTEXT_MODE_DEBUG",
    "CONTEXT_MODE_INDEX_WORKFLOW_RUNS",
    "CONTEXT_MODE_INDEX_DECISIONS",
    "CONTEXT_MODE_INDEX_THREAD_STATE",
    "CONTEXT_MODE_CACHE_ANSWER",
    "ALLOW_PRIVATE_MODEL_FETCH",
    "AGENT_MCP_ENABLED",
    "FEATURE_TYPED_CONTRACTS",
    "FEATURE_STRUCTURED_LOGGING",
    "FEATURE_CROSS_ORIGIN_ISOLATION",
  ];
    const numberKeys = [
    "MODEL_FETCH_TIMEOUT_MS",
    "MAX_MODEL_FETCH_BYTES",
    "CONTEXT_MODE_MAX_RETRIEVAL",
    "CONTEXT_MODE_CONTENT_MAX_LEN",
    "CONTEXT_MODE_SUMMARY_MAX_LEN",
    "CONTEXT_MODE_TARGET_WINDOW_TOKENS",
    "CONTEXT_MODE_HISTORY_BUDGET_TOKENS",
    "CONTEXT_MODE_RETRIEVED_CONTEXT_BUDGET_TOKENS",
    "CONTEXT_MODE_MAX_MESSAGE_TOKENS",
    "CONTEXT_MODE_MAX_CONTEXT_ITEM_TOKENS",
    "CONTEXT_MODE_CACHE_DATA_BUDGET_TOKENS",
    "CONTEXT_MODE_TTL_DAYS",
    "CONTEXT_MODE_CACHE_STALE_MINS",
    "MAX_UPLOAD_MB",
    "MAX_FILES_PER_MESSAGE",
    "ATTACHMENT_PROCESS_TIMEOUT_MS",
    "AGENT_RUNTIME_MAX_STEPS",
    "AGENT_MCP_TIMEOUT_MS",
    "LLM_PARSE_INTENT_TIMEOUT_MS",
    "LLM_GENERATE_REPLY_TIMEOUT_MS",
    "LLM_STREAM_STALL_TIMEOUT_MS",
    "AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES",
    "AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS",
    "ATTACHMENT_SCAN_TIMEOUT_MS",
    "METRICS_PUSH_INTERVAL_MS",
    "METRICS_PUSH_TIMEOUT_MS",
  ];
    const jsonMapKeys = ["CONTEXT_MODE_MODEL_MAX_RETRIEVAL_JSON", "AGENT_MCP_SERVERS_JSON"];

  for (const key of boolKeys) {
        const value = inputs[key];
    if (value === undefined || value === null || value === "") continue;
    if (!isBooleanLike(value)) {
      issues.push({
        path: key,
        expected: "boolean-like value (true/false/1/0/yes/no)",
        received: value,
        fixHint: `Set ${key} to true or false in config.json/env.`,
      });
    }
  }
  for (const key of numberKeys) {
        const value = inputs[key];
    if (value === undefined || value === null || value === "") continue;
    if (!isNumberLike(value)) {
      issues.push({
        path: key,
        expected: "finite number",
        received: value,
        fixHint: `Set ${key} to a numeric value in config.json/env.`,
      });
    }
  }
  for (const key of jsonMapKeys) {
        const value = inputs[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") continue;
    if (typeof value === "string" && safeJsonParse(value) && typeof safeJsonParse(value) === "object") continue;
    issues.push({
      path: key,
      expected: "JSON object",
      received: value,
      fixHint: `Set ${key} as valid JSON object string (or object in config.json).`,
    });
  }

    const mimeTypes = inputs.ALLOWED_MIME_TYPES;
  if (mimeTypes !== undefined && mimeTypes !== null && mimeTypes !== "") {
        const valid =
      (typeof mimeTypes === "string" && !!mimeTypes.trim()) ||
      (Array.isArray(mimeTypes) && mimeTypes.every((v) => typeof v === "string"));
    if (!valid) {
      issues.push({
        path: "ALLOWED_MIME_TYPES",
        expected: "comma-separated string or string[]",
        received: mimeTypes,
        fixHint: "Provide MIME types as csv string or array.",
      });
    }
  }

    const ollamaUrl = inputs.OLLAMA_URL;
  if (ollamaUrl !== undefined && ollamaUrl !== null && ollamaUrl !== "") {
    try {
      // eslint-disable-next-line no-new
      new URL(String(ollamaUrl));
    } catch {
      issues.push({
        path: "OLLAMA_URL",
        expected: "valid URL",
        received: ollamaUrl,
        fixHint: "Set OLLAMA_URL to a valid URL, e.g. http://localhost:11434",
      });
    }
  }
    const scanMode = String(inputs.ATTACHMENT_SCAN_MODE ?? "").trim().toLowerCase();
  if (scanMode && !["off", "clamav", "http"].includes(scanMode)) {
    issues.push({
      path: "ATTACHMENT_SCAN_MODE",
      expected: "one of off|clamav|http",
      received: inputs.ATTACHMENT_SCAN_MODE,
      fixHint: "Set ATTACHMENT_SCAN_MODE to off, clamav, or http.",
    });
  }
    const metricsPushgatewayUrl = inputs.METRICS_PUSHGATEWAY_URL;
  if (metricsPushgatewayUrl !== undefined && metricsPushgatewayUrl !== null && metricsPushgatewayUrl !== "") {
    try {
      // eslint-disable-next-line no-new
      new URL(String(metricsPushgatewayUrl));
    } catch {
      issues.push({
        path: "METRICS_PUSHGATEWAY_URL",
        expected: "valid URL",
        received: metricsPushgatewayUrl,
        fixHint: "Set METRICS_PUSHGATEWAY_URL to a valid URL or leave empty to disable exporter.",
      });
    }
  }
  return issues;
}

/**
 * Normalizes MCP server configuration from JSON/object input.
 *
 * Invalid server entries (including malformed `url`) are dropped.
 */
function normalizeMcpServers(raw: unknown): MCPClientOptions["servers"] {
    const source = typeof raw === "string" && raw.trim()
    ? safeJsonParse(raw)
    : raw;
  if (!source || typeof source !== "object") return {};

    const servers: MCPClientOptions["servers"] = {};
  for (const [name, cfg] of Object.entries(source as Record<string, unknown>)) {
    if (!cfg || typeof cfg !== "object") continue;
        const item = { ...(cfg as Record<string, unknown>) };
    if (typeof item.url === "string" && item.url.trim()) {
      try {
        item.url = new URL(item.url);
      } catch {
        continue;
      }
    }
    servers[name] = item as MCPClientOptions["servers"][string];
  }
  return servers;
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

    const homeDir = path.resolve(
    process.env.AUTOPILOT_HOME?.trim() || path.join(os.homedir(), ".autopilot"),
  );
    const configPath = path.join(homeDir, "config.json");
    const fileCfg = readConfigFile(configPath);

    const fileForce = typeof fileCfg.forceInteractiveQuestions === "boolean"
    ? fileCfg.forceInteractiveQuestions
    : undefined;
  // Single global switch, canonical source: ~/.autopilot/config.json
    const forceInteractiveQuestions = fileForce ?? true;
    const approvalMode = parseApprovalMode(fileCfg.approvalMode, "default");

    const fileUploadDir = typeof fileCfg.uploadDir === "string" && fileCfg.uploadDir.trim()
    ? fileCfg.uploadDir.trim()
    : "";
  // Canonical upload location also comes from runtime config file.
    const uploadDir = path.resolve(fileUploadDir || path.join(homeDir, "uploads"));
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
    const validationIssues = validateRuntimeRawInputs({
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
    ATTACHMENT_PROCESS_TIMEOUT_MS:
      fileCfg.ATTACHMENT_PROCESS_TIMEOUT_MS ?? process.env.ATTACHMENT_PROCESS_TIMEOUT_MS,
    AGENT_RUNTIME_MAX_STEPS: fileCfg.AGENT_RUNTIME_MAX_STEPS ?? process.env.AGENT_RUNTIME_MAX_STEPS,
    AGENT_MCP_ENABLED: fileCfg.AGENT_MCP_ENABLED ?? process.env.AGENT_MCP_ENABLED,
    AGENT_MCP_SERVERS_JSON: fileCfg.AGENT_MCP_SERVERS_JSON ?? process.env.AGENT_MCP_SERVERS_JSON,
    AGENT_MCP_TIMEOUT_MS: fileCfg.AGENT_MCP_TIMEOUT_MS ?? process.env.AGENT_MCP_TIMEOUT_MS,
    LLM_PARSE_INTENT_TIMEOUT_MS: fileCfg.LLM_PARSE_INTENT_TIMEOUT_MS ?? process.env.LLM_PARSE_INTENT_TIMEOUT_MS,
    LLM_GENERATE_REPLY_TIMEOUT_MS: fileCfg.LLM_GENERATE_REPLY_TIMEOUT_MS ?? process.env.LLM_GENERATE_REPLY_TIMEOUT_MS,
    LLM_STREAM_STALL_TIMEOUT_MS: fileCfg.LLM_STREAM_STALL_TIMEOUT_MS ?? process.env.LLM_STREAM_STALL_TIMEOUT_MS,
    AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES:
      fileCfg.AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES ?? process.env.AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES,
    AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS:
      fileCfg.AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS ?? process.env.AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS,
    ATTACHMENT_SCAN_MODE: fileCfg.ATTACHMENT_SCAN_MODE ?? process.env.ATTACHMENT_SCAN_MODE,
    ATTACHMENT_SCAN_FAIL_CLOSED: fileCfg.ATTACHMENT_SCAN_FAIL_CLOSED ?? process.env.ATTACHMENT_SCAN_FAIL_CLOSED,
    ATTACHMENT_SCAN_TIMEOUT_MS: fileCfg.ATTACHMENT_SCAN_TIMEOUT_MS ?? process.env.ATTACHMENT_SCAN_TIMEOUT_MS,
    METRICS_PUSHGATEWAY_URL: fileCfg.METRICS_PUSHGATEWAY_URL ?? process.env.METRICS_PUSHGATEWAY_URL,
    METRICS_JOB_NAME: fileCfg.METRICS_JOB_NAME ?? process.env.METRICS_JOB_NAME,
    METRICS_INSTANCE_ID: fileCfg.METRICS_INSTANCE_ID ?? process.env.METRICS_INSTANCE_ID,
    METRICS_PUSH_INTERVAL_MS: fileCfg.METRICS_PUSH_INTERVAL_MS ?? process.env.METRICS_PUSH_INTERVAL_MS,
    METRICS_PUSH_TIMEOUT_MS: fileCfg.METRICS_PUSH_TIMEOUT_MS ?? process.env.METRICS_PUSH_TIMEOUT_MS,
    METRICS_SNAPSHOT_PATH: fileCfg.METRICS_SNAPSHOT_PATH ?? process.env.METRICS_SNAPSHOT_PATH,
    FEATURE_TYPED_CONTRACTS: fileCfg.FEATURE_TYPED_CONTRACTS ?? process.env.FEATURE_TYPED_CONTRACTS,
    FEATURE_STRUCTURED_LOGGING: fileCfg.FEATURE_STRUCTURED_LOGGING ?? process.env.FEATURE_STRUCTURED_LOGGING,
    FEATURE_CROSS_ORIGIN_ISOLATION:
      fileCfg.FEATURE_CROSS_ORIGIN_ISOLATION ?? process.env.FEATURE_CROSS_ORIGIN_ISOLATION,
  });
  if (validationIssues.length > 0) {
    throw new RuntimeConfigValidationError(validationIssues);
  }

  cached = {
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
      snapshotPath: parseString(
        fileCfg.METRICS_SNAPSHOT_PATH,
        process.env.METRICS_SNAPSHOT_PATH || path.join(path.dirname(configPath), "metrics.snapshot.json"),
      ),
    },
    features: {
      typedContracts: parseBoolean(
        fileCfg.FEATURE_TYPED_CONTRACTS ?? process.env.FEATURE_TYPED_CONTRACTS,
        false,
      ),
      structuredLogging: parseBoolean(
        fileCfg.FEATURE_STRUCTURED_LOGGING ?? process.env.FEATURE_STRUCTURED_LOGGING,
        false,
      ),
      crossOriginIsolation: parseBoolean(
        fileCfg.FEATURE_CROSS_ORIGIN_ISOLATION ?? process.env.FEATURE_CROSS_ORIGIN_ISOLATION,
        false,
      ),
    },
  };
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
 * @returns `true` when interactive questioning is required by runtime policy.
 */
export function isInteractiveQuestionEnforced(): boolean {
  return getRuntimeConfig().forceInteractiveQuestions;
}

/**
 * Clears cached runtime config so the next read reloads from disk/env.
 */
function _resetRuntimeConfigCache(): void {
  cached = null;
}

/**
 * Persists selected runtime preferences to the config file and reloads cache.
 */
function _updateRuntimeConfigFile(
  updates: Partial<Pick<RuntimeConfigFile, "approvalMode" | "forceInteractiveQuestions" | "uploadDir">>,
): RuntimeConfig {
  const current = _getRuntimeConfig();
  const existing = readConfigFile(current.configPath);
  const next: RuntimeConfigFile = {
    ...existing,
    ...updates,
  };
  fs.mkdirSync(current.homeDir, { recursive: true });
  fs.writeFileSync(current.configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  _resetRuntimeConfigCache();
  return _getRuntimeConfig();
}

/**
 * RuntimeConfigManager provides a mockable interface for runtime configuration.
 */
export const RuntimeConfigManager = {
  getRuntimeConfig: _getRuntimeConfig,
  updateRuntimeConfigFile: _updateRuntimeConfigFile,
  resetRuntimeConfigCache: _resetRuntimeConfigCache,
};

// Backward compatibility wrappers
export const getRuntimeConfig = () => RuntimeConfigManager.getRuntimeConfig();
export const updateRuntimeConfigFile = (updates: any) => RuntimeConfigManager.updateRuntimeConfigFile(updates);
export const resetRuntimeConfigCache = () => RuntimeConfigManager.resetRuntimeConfigCache();
