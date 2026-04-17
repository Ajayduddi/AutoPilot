/**
 * @fileoverview apps/frontend/src/routes/chat.helpers.ts
 *
 * High-level purpose:
 * Frontend route module that composes page-level UI, data loading, and user flows for navigation states.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Encapsulates route-scoped layout and state transitions.
 * - Coordinates API interactions with route-specific rendering behavior.
 * - Supports responsive UX patterns for authenticated and guest flows.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Create or update route component exports for target navigation path.
 * 2. Connect route logic to frontend API helpers and shared context providers.
 * 3. Validate route behavior on desktop and mobile with route/e2e tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import type { AssistantBlock, WorkflowStatus } from "../components/chat/types";

/**
 * Normalizes provider identifiers to display-safe canonical names.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param provider - Input value for normalizeProviderName.
 * @returns Return value from normalizeProviderName.
 *
 * @example
 * ```typescript
 * const output = normalizeProviderName(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function normalizeProviderName(provider?: string): string {
  const value = (provider || "").toLowerCase();
  if (value === "ollama_cloud" || value === "ollama") return "ollama";
  return value || "provider";
}

/**
 * Formats a provider name into a human-friendly label.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param name - Input value for prettyProviderName.
 * @returns Return value from prettyProviderName.
 *
 * @example
 * ```typescript
 * const output = prettyProviderName(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function prettyProviderName(name?: string): string {
  const value = normalizeProviderName(name);
  if (value === "openai") return "OpenAI";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Converts workflow status codes into readable status text.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param status - Input value for humanizeStatus.
 * @returns Return value from humanizeStatus.
 *
 * @example
 * ```typescript
 * const output = humanizeStatus(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function humanizeStatus(status: string): string {
  if (status === "waiting_approval") return "waiting for approval";
  return status.replace(/_/g, " ");
}

/**
 * Converts a workflow key into a human-readable title.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param key - Input value for humanizeWorkflowKey.
 * @returns Return value from humanizeWorkflowKey.
 *
 * @example
 * ```typescript
 * const output = humanizeWorkflowKey(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function humanizeWorkflowKey(key?: string): string {
  if (!key) return "Workflow";
  return key
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Coerces an arbitrary status string into a supported workflow status value.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param status - Input value for coerceWorkflowStatus.
 * @returns Return value from coerceWorkflowStatus.
 *
 * @example
 * ```typescript
 * const output = coerceWorkflowStatus(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function coerceWorkflowStatus(status?: string): WorkflowStatus {
  if (status === "completed" || status === "failed" || status === "waiting_approval") return status;
  return "running";
}

/**
 * Creates fallback assistant blocks when structured blocks are unavailable.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param content - Input value for fallbackAssistantBlocks.
 * @returns Return value from fallbackAssistantBlocks.
 *
 * @example
 * ```typescript
 * const output = fallbackAssistantBlocks(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function fallbackAssistantBlocks(content?: string | null): AssistantBlock[] {
  const text = (content || "").trim();
  if (!text) return [];
  const firstSentence = text.split(/(?<=[.!?])\s/).find(Boolean) || text;
  return [
    { type: "summary", items: [firstSentence] },
    { type: "markdown", title: "Results", text },
  ];
}
