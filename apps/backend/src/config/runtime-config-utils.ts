/**
 * @fileoverview apps/backend/src/config/runtime-config-utils.ts
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

export type RuntimeValidationIssue = {
  path: string;
  expected: string;
  received: unknown;
  fixHint: string;
};

export function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

export function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value);
}

export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsDrivePath(value);
}

export function collapsePathSegments(value: string): string {
  const normalized = normalizePathSeparators(value);
  const windowsMatch = normalized.match(/^([A-Za-z]:)(\/.*)?$/);
  const drive = windowsMatch?.[1] ?? "";
  const hasLeadingSlash = normalized.startsWith("/");
  const root = drive ? `${drive}/` : hasLeadingSlash ? "/" : "";
  const rest = drive
    ? (windowsMatch?.[2] ?? "").replace(/^\/+/, "")
    : normalized.replace(/^\/+/, "");

  const segments = rest.split("/").filter((segment) => segment.length > 0);
  const collapsed: string[] = [];
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (collapsed.length > 0 && collapsed[collapsed.length - 1] !== "..") {
        collapsed.pop();
      } else if (!root) {
        collapsed.push("..");
      }
      continue;
    }
    collapsed.push(segment);
  }

  const joined = collapsed.join("/");
  if (!root) return joined || ".";
  return joined ? `${root}${joined}` : root;
}

export function joinPath(...parts: string[]): string {
  const filtered = parts
    .map((part) => normalizePathSeparators(String(part || "")))
    .filter(Boolean);
  if (filtered.length === 0) return ".";

  let current = filtered[0]!;
  for (const part of filtered.slice(1)) {
    if (isAbsolutePath(part)) {
      current = part;
      continue;
    }
    current = `${current.replace(/\/+$/, "")}/${part.replace(/^\/+/, "")}`;
  }
  return collapsePathSegments(current);
}

export function dirnamePath(value: string): string {
  const normalized = collapsePathSegments(value);
  if (normalized === "/" || /^[A-Za-z]:\/?$/.test(normalized)) return normalized;
  const trimmed = normalized.replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash < 0) return ".";
  if (lastSlash === 0) return "/";
  return trimmed.slice(0, lastSlash);
}

export function getHomeDirectory(): string {
  const explicit = String(process.env.AUTOPILOT_HOME || "").trim();
  if (explicit) return collapsePathSegments(explicit);
  const userHome = String(process.env.HOME || process.env.USERPROFILE || "~").trim();
  return joinPath(userHome || "~", ".autopilot");
}

export function getWorkingDirectory(): string {
  return collapsePathSegments(String(process.env.PWD || process.cwd() || "."));
}

export function resolvePath(value: string, baseDir = getWorkingDirectory()): string {
  const normalized = normalizePathSeparators(String(value || "").trim());
  if (!normalized) return collapsePathSegments(baseDir);
  if (isAbsolutePath(normalized)) return collapsePathSegments(normalized);
  return joinPath(baseDir, normalized);
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function isBooleanLike(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on", "0", "false", "no", "off"].includes(normalized);
}

export function isNumberLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    if (!value.trim()) return false;
    return Number.isFinite(Number(value));
  }
  return false;
}

export function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function parseString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function parseStringList(value: unknown): string[] {
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

export function parseNumberMap(value: unknown): Record<string, number> {
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

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isProductionEnv(): boolean {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "0.0.0.0"
    || normalized === "::1";
}

export function validateRuntimeRawInputs(inputs: Record<string, unknown>): RuntimeValidationIssue[] {
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
    "XLSX_MAX_COLS",
    "XLSX_MAX_ROWS_RENDER_PER_SHEET",
    "XLSX_MAX_ROWS_PARSE_PER_SHEET",
    "AGENT_RUNTIME_MAX_STEPS",
    "AGENT_MCP_TIMEOUT_MS",
    "LLM_PARSE_INTENT_TIMEOUT_MS",
    "LLM_GENERATE_REPLY_TIMEOUT_MS",
    "LLM_STREAM_STALL_TIMEOUT_MS",
    "WORKFLOW_CONTEXT_CACHE_TTL_MS",
    "LLM_INTENT_WORKFLOW_SHORTLIST",
    "LLM_REPLY_WORKFLOW_SHORTLIST",
    "AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES",
    "AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS",
    "AUTO_ROUTER_DISCOVERY_TTL_MS",
    "AUTO_ROUTER_DISCOVERY_TIMEOUT_MS",
    "AUTO_ROUTER_MAX_MODELS_PER_PROVIDER",
    "AUTO_ROUTER_MAX_CANDIDATES",
    "ATTACHMENT_SCAN_TIMEOUT_MS",
    "CLAMAV_PORT",
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
    if (typeof value === "string") {
      const parsed = safeJsonParse(value);
      if (parsed && typeof parsed === "object") continue;
    }
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

  if (isProductionEnv()) {
    const requiredProductionUrls = [
      {
        key: "OLLAMA_URL",
        value: inputs.OLLAMA_URL,
        hint: "Set OLLAMA_URL explicitly in config.json/env for production deployments.",
      },
      {
        key: "CALLBACK_BASE_URL",
        value: inputs.CALLBACK_BASE_URL,
        hint: "Set CALLBACK_BASE_URL explicitly to your public backend origin in production.",
      },
      {
        key: "FRONTEND_ORIGIN",
        value: inputs.FRONTEND_ORIGIN,
        hint: "Set FRONTEND_ORIGIN explicitly to your public frontend origin in production.",
      },
    ] as const;

    for (const item of requiredProductionUrls) {
      const raw = item.value;
      if (raw === undefined || raw === null || raw === "") {
        issues.push({
          path: item.key,
          expected: "explicit production URL",
          received: raw,
          fixHint: item.hint,
        });
        continue;
      }

      try {
        const parsed = new URL(String(raw));
        if (isLoopbackHostname(parsed.hostname)) {
          issues.push({
            path: item.key,
            expected: "non-loopback production URL",
            received: raw,
            fixHint: `${item.hint} Avoid localhost or loopback URLs in production.`,
          });
        }
      } catch {
        // Base URL validity is already covered above where applicable.
      }
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

  const googleRedirectUri = inputs.GOOGLE_REDIRECT_URI;
  if (googleRedirectUri !== undefined && googleRedirectUri !== null && googleRedirectUri !== "") {
    try {
      new URL(String(googleRedirectUri));
    } catch {
      issues.push({
        path: "GOOGLE_REDIRECT_URI",
        expected: "valid URL",
        received: googleRedirectUri,
        fixHint: "Set GOOGLE_REDIRECT_URI to a valid callback URL.",
      });
    }
  }

  const attachmentScanHttpUrl = inputs.ATTACHMENT_SCAN_HTTP_URL;
  if (attachmentScanHttpUrl !== undefined && attachmentScanHttpUrl !== null && attachmentScanHttpUrl !== "") {
    try {
      new URL(String(attachmentScanHttpUrl));
    } catch {
      issues.push({
        path: "ATTACHMENT_SCAN_HTTP_URL",
        expected: "valid URL",
        received: attachmentScanHttpUrl,
        fixHint: "Set ATTACHMENT_SCAN_HTTP_URL to a valid scanner endpoint URL.",
      });
    }
  }

  const mistralBaseUrl = inputs.MISTRAL_OCR_BASE_URL;
  if (mistralBaseUrl !== undefined && mistralBaseUrl !== null && mistralBaseUrl !== "") {
    try {
      new URL(String(mistralBaseUrl));
    } catch {
      issues.push({
        path: "MISTRAL_OCR_BASE_URL",
        expected: "valid URL",
        received: mistralBaseUrl,
        fixHint: "Set MISTRAL_OCR_BASE_URL to a valid OCR API base URL.",
      });
    }
  }

  return issues;
}

export function normalizeMcpServers(raw: unknown): MCPClientOptions["servers"] {
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
