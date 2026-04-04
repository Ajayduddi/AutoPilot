import type { InboxNotification } from "../context/notifications.context";

/**
 * Interface describing workflow notification insight shape.
 */
export interface WorkflowNotificationInsight {
  kind?: string;
  summary?: string;
  bullets?: string[];
  rawPreview?: string;
  suggestedQuestions?: string[];
  workflowKey?: string;
  provider?: string;
  status?: string;
  runId?: string;
  traceId?: string;
  generatedBy?: "ai" | "fallback";
}

/**
 * Builds a concise headline from notification text.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param text - Input value for toHeadline.
 * @param max = 82 - Input value for toHeadline.
 * @returns Return value from toHeadline.
 *
 * @example
 * ```typescript
 * const output = toHeadline(value, value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function toHeadline(text: string, max = 82): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  const headline = firstSentence.replace(/[.:;,\s]+$/, "");
  return headline.length <= max ? headline : `${headline.slice(0, max - 3).trim()}...`;
}

/**
 * Checks whether a notification title is a generic workflow status heading.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param title - Input value for isGenericWorkflowTitle.
 * @returns Return value from isGenericWorkflowTitle.
 *
 * @example
 * ```typescript
 * const output = isGenericWorkflowTitle(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function isGenericWorkflowTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    normalized.startsWith("workflow completed") ||
    normalized.startsWith("workflow failed") ||
    normalized.startsWith("workflow started") ||
    normalized.startsWith("workflow dispatch failed")
  );
}

/**
 * Narrows an unknown value to a plain object record.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for isRecord.
 * @returns Return value from isRecord.
 *
 * @example
 * ```typescript
 * const output = isRecord(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalizes an unknown value into a trimmed string array with a hard limit.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for normalizeStringArray.
 * @param limit - Input value for normalizeStringArray.
 * @returns Return value from normalizeStringArray.
 *
 * @example
 * ```typescript
 * const output = normalizeStringArray(value, value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * Extracts structured workflow insight details from notification payload data.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param notification - Input value for getWorkflowInsight.
 * @returns Return value from getWorkflowInsight.
 *
 * @example
 * ```typescript
 * const output = getWorkflowInsight(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function getWorkflowInsight(notification: InboxNotification): WorkflowNotificationInsight | null {
  if (!isRecord(notification.data)) return null;
  const raw = notification.data;
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : undefined;
  const bullets = normalizeStringArray(raw.bullets, 4);
  const rawPreview = typeof raw.rawPreview === "string" ? raw.rawPreview : undefined;
  const kind = typeof raw.kind === "string" ? raw.kind : undefined;

  if (!summary && bullets.length === 0 && !rawPreview) return null;

  return {
    kind,
    summary,
    bullets,
    rawPreview,
    suggestedQuestions: normalizeStringArray(raw.suggestedQuestions, 3),
    workflowKey: typeof raw.workflowKey === "string" ? raw.workflowKey : undefined,
    provider: typeof raw.provider === "string" ? raw.provider : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    runId: typeof raw.runId === "string" ? raw.runId : notification.runId,
    traceId: typeof raw.traceId === "string" ? raw.traceId : undefined,
    generatedBy: raw.generatedBy === "ai" ? "ai" : raw.generatedBy === "fallback" ? "fallback" : undefined,
  };
}

/**
 * Computes the best display title for a notification using insight and fallback data.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param notification - Input value for getNotificationDisplayTitle.
 * @returns Return value from getNotificationDisplayTitle.
 *
 * @example
 * ```typescript
 * const output = getNotificationDisplayTitle(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function getNotificationDisplayTitle(notification: InboxNotification): string {
  const fallback = notification.title || "Notification";
  if (!isGenericWorkflowTitle(fallback)) return fallback;
  const insight = getWorkflowInsight(notification);
  if (insight?.summary) {
    const fromSummary = toHeadline(insight.summary);
    if (fromSummary) return fromSummary;
  }

  if (notification.message) {
    const fromMessage = toHeadline(notification.message);
    if (fromMessage) return fromMessage;
  }

  return fallback;
}

/**
 * Truncates text to a maximum length and appends an ellipsis when needed.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param text - Input value for cap.
 * @param max - Input value for cap.
 * @returns Return value from cap.
 *
 * @example
 * ```typescript
 * const output = cap(value, value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

/**
 * Builds a follow-up prompt draft for asking questions about a workflow result.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from buildFollowUpDraft.
 *
 * @example
 * ```typescript
 * const output = buildFollowUpDraft();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function buildFollowUpDraft(
  notification: InboxNotification,
  insight: WorkflowNotificationInsight | null,
  question?: string,
): string {
  const subject = insight?.workflowKey || notification.title;
  const lines: string[] = [
    `I want to ask a follow-up question about this autonomous workflow result: ${subject}.`,
  ];

  if (insight?.summary) {
    lines.push(`Summary: ${cap(insight.summary, 500)}`);
  }

  if (insight?.bullets && insight.bullets.length > 0) {
    lines.push(`Highlights: ${insight.bullets.map((point) => cap(point, 200)).join(" | ")}`);
  }

  if (insight?.runId || notification.runId) {
    lines.push(`Run ID: ${insight?.runId || notification.runId}`);
  }

  if (insight?.traceId) {
    lines.push(`Trace ID: ${insight.traceId}`);
  }
  const trimmedQuestion = (question || "").trim();
  lines.push(`My question: ${trimmedQuestion}`);
  return cap(lines.join("\n"), 1300);
}
