import type { InboxNotification } from "../context/notifications.context";

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

function toHeadline(text: string, max = 82): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  const headline = firstSentence.replace(/[.:;,\s]+$/, "");
  return headline.length <= max ? headline : `${headline.slice(0, max - 3).trim()}...`;
}

function isGenericWorkflowTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    normalized.startsWith("workflow completed") ||
    normalized.startsWith("workflow failed") ||
    normalized.startsWith("workflow started") ||
    normalized.startsWith("workflow dispatch failed")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
}

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

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

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
