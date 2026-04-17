/**
 * @fileoverview apps/frontend/src/lib/runtime-reporter.ts
 *
 * High-level purpose:
 * Frontend utility/integration module for API communication and shared client-side helper behavior.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Abstracts transport and formatting details from UI components.
 * - Provides reusable helper contracts for request/response workflows.
 * - Keeps client integration logic testable and centrally maintained.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import helper functions into components, routes, or contexts.
 * 2. Compose utilities with domain-specific UI behavior in callers.
 * 3. Update associated unit tests when changing helper contracts.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

type RuntimeReportMeta = {
  error?: unknown;
  details?: unknown;
};

function shouldLog(level: RuntimeLogLevel): boolean {
  return import.meta.env.DEV || level === "warn" || level === "error";
}

function formatArgs(message: string, meta?: RuntimeReportMeta): unknown[] {
  const args: unknown[] = [message];
  if (meta?.error !== undefined) args.push(meta.error);
  else if (meta?.details !== undefined) args.push(meta.details);
  return args;
}

export function reportRuntime(level: RuntimeLogLevel, message: string, meta?: RuntimeReportMeta) {
  if (!shouldLog(level)) return;
  const args = formatArgs(message, meta);
  if (level === "error") console.error(...args);
  else if (level === "warn") console.warn(...args);
  else if (level === "info") console.info(...args);
  else console.debug(...args);
}

export function reportRuntimeError(message: string, error?: unknown) {
  reportRuntime("error", message, { error });
}

export function reportRuntimeWarn(message: string, details?: unknown) {
  reportRuntime("warn", message, { details });
}

export function reportRuntimeInfo(message: string, details?: unknown) {
  reportRuntime("info", message, { details });
}

export function reportRuntimeDebug(message: string, details?: unknown) {
  reportRuntime("debug", message, { details });
}
