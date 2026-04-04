/**
 * @fileoverview util/logger.
 *
 * Structured/unstructured backend logging helpers.
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

/**
 * Emits a log entry in either plain or structured JSON format.
 */
function emit(level: LogLevel, payload: LogPayload): void {
  const runtime = getRuntimeConfig();
  if (!runtime.features.structuredLogging) {
    const prefix = payload.scope ? `[${payload.scope}] ` : "";
    const line = `${prefix}${payload.message}`;
    if (level === "error") {
      console.error(line, payload);
      return;
    }
    if (level === "warn") {
      console.warn(line, payload);
      return;
    }
    if (level === "debug") {
      console.debug(line, payload);
      return;
    }
    console.log(line, payload);
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    ...payload,
  };
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
