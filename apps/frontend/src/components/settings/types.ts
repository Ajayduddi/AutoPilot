import type { Accessor } from "solid-js";

export type WebhookSecretRecord = {
  id: string;
  label: string;
  secretPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  status?: string;
  secret?: string;
};

export type SettingsSection = "connections" | "webhooks" | "account";

export type ConfirmState = {
  kind: "delete-provider" | "revoke-secret";
  id: string;
  title: string;
  description: string;
  actionLabel: string;
};

export type PageNotice = { tone: "success" | "error"; message: string } | null;
export type PageNoticeAccessor = Accessor<PageNotice>;

export const providerSelectOptions = [
  { value: "openai", label: "OpenAI Compatible API" },
  { value: "ollama", label: "Ollama" },
  { value: "mistral", label: "Mistral" },
  { value: "gemini", label: "Gemini" },
  { value: "groq", label: "Groq" },
] as const;

export const settingsCls = {
  pageContainer: "w-full max-w-[1680px] mx-auto",
  contentGrid: "grid grid-cols-1 md:grid-cols-[236px_minmax(0,1fr)] gap-6 items-start",
  shell: "rounded-2xl border border-neutral-800/70 bg-neutral-950/65",
  sectionCard: "rounded-2xl border border-neutral-800/70 bg-neutral-950/60",
  subCard: "rounded-xl border border-neutral-800/70 bg-neutral-900/45",
  rowCard: "rounded-xl border border-neutral-800/70 bg-neutral-900/35",
  field:
    "w-full h-10 rounded-lg border border-neutral-700/80 bg-neutral-900/90 px-3 text-neutral-100 focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25 transition-colors",
  subtleBtn: "text-xs px-3 py-1.5 rounded-lg border transition-all duration-200",
  primaryBtn:
    "h-10 px-4 rounded-lg border border-indigo-500/35 bg-indigo-500/15 text-indigo-300 hover:text-white hover:bg-indigo-500/25 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  destructiveBtn:
    "text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 hover:text-white hover:bg-red-500/18 hover:border-red-400/45 transition-all duration-200",
};

export const unifiedCallbackUrl = "http://localhost:3000/api/webhooks/callback";

export const unifiedExample = `await fetch("${unifiedCallbackUrl}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-webhook-secret": "whsec_your_generated_key_here"
  },
  body: JSON.stringify({
    workflowKey: "wf_portfolio",
    provider: "n8n",
    status: "completed",
    result: { message: "done" }
  })
});`;

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function providerLabel(value: string): string {
  if (value === "ollama_cloud") return "Ollama";
  return providerSelectOptions.find((opt) => opt.value === value)?.label ?? value;
}

export function formatDate(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}
