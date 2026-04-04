import { For, Show, type Accessor } from "solid-js";
import { formatDate, settingsCls, unifiedCallbackUrl, unifiedExample, type WebhookSecretRecord } from "./types";

/**
 * Utility function to settings section webhooks.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from SettingsSectionWebhooks.
 *
 * @example
 * ```typescript
 * const output = SettingsSectionWebhooks();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function SettingsSectionWebhooks(props: {
  webhookErrorMsg: Accessor<string>;
  webhookLabel: Accessor<string>;
  setWebhookLabel: (value: string) => void;
  isGeneratingWebhookKey: Accessor<boolean>;
  generatedWebhookSecret: Accessor<string>;
  copiedWebhookSecret: Accessor<boolean>;
  setGeneratedWebhookSecret: (value: string) => void;
  setCopiedWebhookSecret: (value: boolean) => void;
  copiedEndpoint: Accessor<"" | "unified">;
  copiedExample: Accessor<"" | "unified">;
  expandedExamples: Accessor<{ unified: boolean }>;
  activeWebhookSecrets: Accessor<WebhookSecretRecord[]>;
  handleGenerateWebhookSecret: () => void;
  handleCopyGeneratedWebhookSecret: () => void;
  copyEndpoint: (kind: "unified", value: string) => void;
  copyExample: (kind: "unified", value: string) => void;
  toggleExample: (kind: "unified") => void;
  requestRevokeWebhookSecret: (id: string) => void;
}) {
  return (
    <section class={`${settingsCls.sectionCard} p-5 md:p-8 space-y-6 md:space-y-8`}>
      <div class="border-b border-neutral-800/40 pb-4">
        <h2 class="text-lg md:text-xl font-semibold text-neutral-100 tracking-tight">Webhooks & Secrets</h2>
        <p class="text-[13px] md:text-[14px] text-neutral-500 mt-1">Configure unified callback endpoints and API keys for external trigger systems.</p>
      </div>

      <div class={`${settingsCls.subCard} p-4 sm:p-5`}>
        <div class="mb-4">
          <p class="text-[14px] sm:text-[15px] font-medium text-neutral-200 tracking-tight">Callback Endpoints</p>
          <p class="text-[12px] sm:text-[13px] text-neutral-500 mt-1">
            URLs mapped internally to current agent sessions, used by external services like n8n or Zapier.
          </p>
        </div>

        <div class="space-y-4">
          <div>
            <div class="flex items-center justify-between mb-1.5 px-0.5">
              <span class="text-[12px] font-medium text-neutral-300">Unified Callback (all providers)</span>
            </div>
            <div class="flex items-stretch gap-2">
              <code class="flex-1 flex items-center px-4 py-2.5 sm:py-0 min-h-[44px] rounded-xl border border-neutral-700/60 bg-[#121212] text-neutral-300 font-mono text-[12px] sm:text-[13px] break-all sm:truncate shadow-inner leading-relaxed">
                {unifiedCallbackUrl}
              </code>
              <button
                onClick={() => props.copyEndpoint("unified", unifiedCallbackUrl)}
                class="flex items-center justify-center w-11 rounded-xl bg-neutral-800/50 hover:bg-neutral-700/80 text-neutral-400 hover:text-white border border-neutral-700/50 transition-colors shrink-0"
                title="Copy endpoint URL"
              >
                <Show when={props.copiedEndpoint() === "unified"} fallback={
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                }>
                  <svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </Show>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class={`${settingsCls.subCard} p-4 sm:p-5`}>
        <div class="mb-4">
          <p class="text-[14px] sm:text-[15px] font-medium text-neutral-200 tracking-tight">Example HTTP Requests</p>
          <p class="text-[12px] sm:text-[13px] text-neutral-500 mt-1">Collapsed by default</p>
        </div>

        <div class="border border-neutral-800/60 rounded-xl bg-neutral-900/40 overflow-hidden">
          <button
            onClick={() => props.toggleExample("unified")}
            class="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-800/40 transition-colors"
          >
            <span class="text-[13px] font-medium text-neutral-300 tracking-tight">Unified callback (JavaScript fetch)</span>
            <div class="flex items-center gap-3">
              <div
                role="button"
                tabindex="0"
                onClick={(e) => {
                  e.stopPropagation();
                  props.copyExample("unified", unifiedExample);
                }}
                class="p-1.5 text-neutral-500 hover:text-neutral-200 transition-colors rounded-md hover:bg-neutral-700/50"
                title="Copy example code"
              >
                <Show when={props.copiedExample() === "unified"} fallback={
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                }>
                  <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </Show>
              </div>
              <svg
                class={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${props.expandedExamples().unified ? "rotate-180" : ""}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>
          <Show when={props.expandedExamples().unified}>
            <div class="p-4 pt-0 border-t border-neutral-800/40 mt-1">
              <pre class="bg-[#121212] rounded-xl border border-neutral-800/60 p-4 overflow-x-auto text-[11px] sm:text-[12px] text-neutral-300 font-mono shadow-inner leading-relaxed">
                <code>{unifiedExample}</code>
              </pre>
            </div>
          </Show>
        </div>
      </div>

      <div class={`${settingsCls.subCard} p-4 sm:p-5`}>
        <div class="mb-4">
          <p class="text-[14px] sm:text-[15px] font-medium text-neutral-200 tracking-tight">Callback Secret Keys</p>
          <p class="text-[12px] sm:text-[13px] text-neutral-500 mt-1">Send this secret in the <code>x-webhook-secret</code> HTTP header.</p>
        </div>

        <Show when={props.webhookErrorMsg()}>
          <div class="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] break-all">
            {props.webhookErrorMsg()}
          </div>
        </Show>

        <div class="flex flex-col sm:flex-row items-center gap-3 mb-6">
          <input
            type="text"
            placeholder="Optional key label (e.g. Production n8n)"
            value={props.webhookLabel()}
            onInput={(e) => props.setWebhookLabel(e.currentTarget.value)}
            class="w-full sm:flex-1 h-11 px-4 sm:px-5 rounded-full text-[14px] sm:text-[15px] bg-[#121212] border border-neutral-700/60 text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors shrink-0 outline-none m-0 box-border"
          />
          <button
            onClick={props.handleGenerateWebhookSecret}
            disabled={props.isGeneratingWebhookKey()}
            class={`w-full sm:w-auto shrink-0 flex items-center justify-center gap-1.5 h-11 px-5 sm:px-6 rounded-full text-[14px] font-medium transition-colors m-0 box-border whitespace-nowrap ${props.isGeneratingWebhookKey()
                ? "bg-neutral-800/30 text-neutral-500 cursor-not-allowed border border-transparent"
                : "bg-white hover:bg-neutral-100 text-black border border-transparent shadow-sm active:scale-[0.98]"
              }`}
          >
            <Show when={props.isGeneratingWebhookKey()} fallback={
              <>
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
                <span>Generate Key</span>
              </>
            }>
              <div class="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              <span>Generating...</span>
            </Show>
          </button>
        </div>

        <Show when={props.generatedWebhookSecret()}>
          <div class="mb-5 p-4 sm:p-5 rounded-xl border border-amber-500/25 bg-amber-500/5 shadow-sm">
            <div class="text-[13px] sm:text-[14px] text-amber-300 font-medium mb-3 tracking-tight">Copy this key now. It is only shown once.</div>
            <code class="block w-full bg-[#121212] border border-neutral-800/60 rounded-xl px-3 py-2 sm:p-4 text-neutral-200 font-mono text-[11px] sm:text-[13px] shadow-inner break-all">
              {props.generatedWebhookSecret()}
            </code>
            <div class="flex items-center gap-2 mt-4">
              <button
                onClick={props.handleCopyGeneratedWebhookSecret}
                class="flex items-center justify-center gap-2 bg-amber-400/15 hover:bg-amber-400/25 text-amber-200 h-8 px-3 rounded-lg border border-amber-400/20 transition-colors"
                title="Copy Key"
              >
                <Show when={props.copiedWebhookSecret()} fallback={
                  <><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="text-[12px] font-medium">Copy Key</span></>
                }>
                  <><svg class="w-3.5 h-3.5 text-amber-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span class="text-[12px] font-medium">Copied!</span></>
                </Show>
              </button>
              <button
                onClick={() => {
                  props.setGeneratedWebhookSecret("");
                  props.setCopiedWebhookSecret(false);
                }}
                class="text-[12px] font-medium text-neutral-400 hover:text-white h-8 px-3 rounded-lg hover:bg-neutral-800/40 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </Show>

        <div class="space-y-4">
          <Show when={props.activeWebhookSecrets().length === 0}>
            <div class={`rounded-xl border border-neutral-800/40 bg-[#121212] px-4 py-8 text-[13px] text-neutral-500 text-center`}>
              No active callback keys yet. Generate a key to accept provider callbacks.
            </div>
          </Show>

          <For each={props.activeWebhookSecrets()}>
            {(secret) => (
              <div class="rounded-2xl border border-neutral-800/60 bg-[#121212] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-0 sm:gap-6 transition-colors hover:border-neutral-700/60 hover:bg-neutral-900/40">
                <div class="flex flex-col gap-2 min-w-0 flex-1 mb-4 sm:mb-0">
                  <div class="flex items-center gap-2.5">
                    <span class="text-[14px] sm:text-[15px] font-medium text-neutral-200 tracking-tight truncate">{secret.label || "Unnamed key"}</span>
                    <span class="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 leading-none shrink-0">
                      ACTIVE
                    </span>
                  </div>
                  <code class="text-[13px] text-neutral-400 font-mono truncate px-2 py-1 bg-neutral-900/50 rounded-lg border border-neutral-800/50 w-fit max-w-full">
                    {secret.secretPrefix}...
                  </code>
                </div>

                <div class="flex flex-row items-center justify-between sm:justify-end w-full sm:w-auto shrink-0 pt-4 sm:pt-0 border-t border-dashed border-neutral-800/50 sm:border-0 sm:border-solid gap-4 sm:gap-8">
                  <div class="flex flex-row items-center gap-6 sm:gap-8 text-[12px] shrink-0">
                    <div class="flex flex-col gap-0.5">
                      <span class="text-neutral-500 text-[10px] uppercase tracking-wider font-bold mb-0.5">Created</span>
                      <span class="text-neutral-300 font-medium">{new Date(secret.createdAt).toLocaleDateString()}</span>
                      <span class="text-neutral-500 text-[11px]">{new Date(secret.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    <Show when={secret.lastUsedAt}>
                      <div class="flex flex-col gap-0.5">
                        <span class="text-neutral-500 text-[10px] uppercase tracking-wider font-bold mb-0.5">Last Used</span>
                        <span class="text-neutral-300 font-medium">{new Date(secret.lastUsedAt!).toLocaleDateString()}</span>
                        <span class="text-neutral-500 text-[11px]">{new Date(secret.lastUsedAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                    </Show>
                  </div>

                  <div class="flex justify-end shrink-0 sm:ml-2">
                    <button
                      onClick={() => props.requestRevokeWebhookSecret(secret.id)}
                      class="flex items-center justify-center gap-1.5 px-3 py-2 text-red-500 sm:text-red-400 opacity-90 sm:opacity-80 hover:text-red-400 sm:hover:text-red-300 hover:bg-red-500/10 hover:opacity-100 rounded-xl transition-all"
                      title="Revoke callback key"
                    >
                      <svg class="w-4 h-4 shrink-0 transition-transform hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                      <span class="text-[13px] font-medium pr-0.5 sm:hidden lg:inline">Revoke</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
