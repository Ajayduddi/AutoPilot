import type { AssistantBlock, WorkflowStatus } from "../components/chat/types";

export function normalizeProviderName(provider?: string): string {
  const value = (provider || "").toLowerCase();
  if (value === "ollama_cloud" || value === "ollama") return "ollama";
  return value || "provider";
}

export function prettyProviderName(name?: string): string {
  const value = normalizeProviderName(name);
  if (value === "openai") return "OpenAI";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function humanizeStatus(status: string): string {
  if (status === "waiting_approval") return "waiting for approval";
  return status.replace(/_/g, " ");
}

export function humanizeWorkflowKey(key?: string): string {
  if (!key) return "Workflow";
  return key
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function coerceWorkflowStatus(status?: string): WorkflowStatus {
  if (status === "completed" || status === "failed" || status === "waiting_approval") return status;
  return "running";
}

export function fallbackAssistantBlocks(content?: string | null): AssistantBlock[] {
  const text = (content || "").trim();
  if (!text) return [];

  const firstSentence = text.split(/(?<=[.!?])\s/).find(Boolean) || text;
  return [
    { type: "summary", items: [firstSentence] },
    { type: "markdown", title: "Results", text },
  ];
}
