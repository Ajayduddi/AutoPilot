import type { Accessor } from "solid-js";

/**
  * webhook secret record type alias.
  */
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

/**
  * settings section type alias.
  */
export type SettingsSection = "connections" | "webhooks" | "account";

/**
  * confirm state type alias.
  */
export type ConfirmState = {
  kind: "delete-provider" | "revoke-secret";
  id: string;
  title: string;
  description: string;
  actionLabel: string;
};

/**
  * page notice type alias.
  */
export type PageNotice = { tone: "success" | "error"; message: string } | null;
/**
  * page notice accessor type alias.
  */
export type PageNoticeAccessor = Accessor<PageNotice>;
export const providerSelectOptions = [
  { value: "openai", label: "OpenAI Compatible API" },
  { value: "ollama", label: "Ollama" },
  { value: "mistral", label: "Mistral" },
  { value: "gemini", label: "Gemini" },
  { value: "groq", label: "Groq" },
] as const;
export const settingsCls = {
  pageContainer: "w-full max-w-7xl mx-auto",
  contentGrid: "grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 md:gap-10 items-start",
  shell: "rounded-2xl border border-neutral-800/70 bg-neutral-950/65",
  sectionCard: "rounded-2xl md:rounded-3xl border border-neutral-800/50 bg-[#0f0f0f] md:bg-[#0f0f0f] shadow-none md:shadow-[0_1px_3px_rgba(0,0,0,0.3)]",
  subCard: "rounded-xl md:rounded-2xl border border-neutral-800/40 bg-[#151515]",
  rowCard: "rounded-xl border border-neutral-800/40 bg-[#161616] shadow-none",
  field:
    "w-full h-11 rounded-xl border border-neutral-800/60 bg-[#161616] px-3.5 text-[15px] text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600 focus:bg-[#1a1a1a] transition-all",
  subtleBtn: "text-xs px-3.5 py-2 rounded-xl border border-neutral-800/60 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700/60 hover:bg-[#1a1a1a] transition-all duration-200",
  primaryBtn:
    "h-11 px-5 rounded-xl bg-neutral-100 text-black hover:bg-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  destructiveBtn:
    "text-xs px-3.5 py-2 rounded-xl border border-red-500/20 text-red-400 bg-red-500/5 hover:text-red-300 hover:bg-red-500/10 hover:border-red-400/30 transition-all duration-200",
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

/**
 * Utility function to provider label.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for providerLabel.
 * @returns Return value from providerLabel.
 *
 * @example
 * ```typescript
 * const output = providerLabel(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function providerLabel(value: string): string {
  if (value === "ollama_cloud") return "Ollama";
  return providerSelectOptions.find((opt) => opt.value === value)?.label ?? value;
}

/**
 * Utility function to format date.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for formatDate.
 * @returns Return value from formatDate.
 *
 * @example
 * ```typescript
 * const output = formatDate(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function formatDate(value?: string | null): string {
  if (!value) return "Never";
  /**
   * Utility function to date variable.
   */
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}
