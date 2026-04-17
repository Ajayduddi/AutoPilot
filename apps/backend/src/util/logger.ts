/**
 * @fileoverview util/logger.
 *
 * High-level purpose:
 * Shared backend utilities for operational concerns and low-level helpers.
 *
 * Key Features (and trade-offs):
 * - Encapsulates reusable helper logic for runtime infrastructure.
 * - Supports observability, networking, and internal mechanics.
 * - Avoids duplication of common platform helper behavior.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Use utility helpers where cross-domain reuse is needed.
 * 3. Keep helpers side-effect-light and composable.
 * 4. Verify callers after utility contract changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { getRuntimeConfig } from "../config/runtime.config";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogPayload = {
  message: string;
  scope?: string;
  traceId?: string;
  threadId?: string;
  userId?: string;
  workflowKey?: string;
  model?: string;
  routeKind?: string;
  [key: string]: unknown;
};

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|token|secret|password|api[_-]?key|credential|private[_-]?key|client[_-]?secret)/i;
const MAX_REDACTION_DEPTH = 5;

function isDevelopment(): boolean {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "development";
}

function sanitizeString(value: string): string {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+\b/gi, `Bearer ${REDACTED}`)
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization|password|secret|client[_ -]?secret)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, `$1${REDACTED}`)
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|auth|authorization|password|secret)=)[^&\s]+/gi, `$1${REDACTED}`);
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACTION_DEPTH) return "[truncated]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      ...(isDevelopment() && value.stack ? { stack: sanitizeString(value.stack) } : {}),
    };
  }
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>);
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = REDACTED;
      continue;
    }
    sanitized[key] = sanitizeUnknown(child, depth + 1);
  }
  return sanitized;
}

/**
 * Emits a log entry in either plain or structured JSON format.
 */
function emit(level: LogLevel, payload: LogPayload): void {
  let structuredLogging = false;
  try {
    structuredLogging = Boolean(getRuntimeConfig()?.features?.structuredLogging);
  } catch {
    structuredLogging = false;
  }

  if (!structuredLogging) {
    const sanitized = sanitizeUnknown(payload) as LogPayload;
    const prefix = sanitized.scope ? `[${sanitized.scope}] ` : "";
    const line = `${prefix}${sanitized.message}`;
    if (level === "error") {
      console.error(line, sanitized);
      return;
    }
    if (level === "warn") {
      console.warn(line, sanitized);
      return;
    }
    if (level === "debug") {
      console.debug(line, sanitized);
      return;
    }
    console.log(line, sanitized);
    return;
  }

  const entry = sanitizeUnknown({
    ts: new Date().toISOString(),
    level,
    ...payload,
  });
  const text = JSON.stringify(entry);
  if (level === "error") return console.error(text);
  if (level === "warn") return console.warn(text);
  if (level === "debug") return console.debug(text);
  return console.log(text);
}

/**
 * logger exported constant.
 */
export const logger = {
  /** Emits a debug-level log entry. */
  debug(payload: LogPayload) {
    emit("debug", payload);
  },
  /** Emits an info-level log entry. */
  info(payload: LogPayload) {
    emit("info", payload);
  },
  /** Emits a warn-level log entry. */
  warn(payload: LogPayload) {
    emit("warn", payload);
  },
  /** Emits an error-level log entry. */
  error(payload: LogPayload) {
    emit("error", payload);
  },
};
