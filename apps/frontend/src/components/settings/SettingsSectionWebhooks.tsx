import { For, Show, type Accessor } from "solid-js";
import { formatDate, settingsCls, unifiedCallbackUrl, unifiedExample, type WebhookSecretRecord } from "./types";

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
    <section class={`${settingsCls.sectionCard} p-5 md:p-6 space-y-5`}>
      <div>
        <h2 class="text-sm font-semibold text-neutral-100">Webhooks & Secrets</h2>
        <p class="text-xs text-neutral-500 mt-1">Use callback endpoints and secure keys for provider integrations.</p>
      </div>

      <div class={`${settingsCls.subCard} p-4 space-y-3`}>
        <div>
          <p class="text-xs font-semibold text-neutral-200">Callback Endpoints</p>
          <p class="text-xs text-neutral-500 mt-1.5">
            Execution URLs are configured per workflow and used for provider callbacks into this platform.
          </p>
        </div>

        <div class={`${settingsCls.rowCard} p-3.5`}>
          <div class="flex items-center justify-between gap-3 mb-2.5">
            <p class="text-sm text-neutral-300">Unified Callback (all providers)</p>
            <button
              onClick={() => props.copyEndpoint("unified", unifiedCallbackUrl)}
              class={`${settingsCls.subtleBtn} h-8 px-3 border-neutral-700/80 text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800/65 hover:border-neutral-500`}
            >
              {props.copiedEndpoint() === "unified" ? "Copied" : "Copy"}
            </button>
          </div>
          <code class="block w-full rounded-lg border border-neutral-800/75 bg-neutral-900/60 px-3 py-2.5 text-neutral-200 font-mono text-sm break-all">
            {unifiedCallbackUrl}
          </code>
        </div>
      </div>

      <div class={`${settingsCls.subCard} p-4 space-y-3`}>
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-xs font-semibold text-neutral-200">Example HTTP Requests</p>
            <p class="text-xs text-neutral-500 mt-1">Collapsed by default</p>
          </div>
        </div>

        <div class={settingsCls.rowCard}>
          <div class="w-full flex items-center justify-between gap-3 px-4 py-3">
            <button
              onClick={() => props.toggleExample("unified")}
              class="flex-1 flex items-center gap-2 text-left text-sm text-neutral-300 hover:text-neutral-100 transition-colors"
            >
              <span>Unified callback (JavaScript fetch)</span>
              <span class="text-neutral-500">
                <svg
                  class={`w-4 h-4 transition-transform ${props.expandedExamples().unified ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            <button
              onClick={() => props.copyExample("unified", unifiedExample)}
              class={`${settingsCls.subtleBtn} h-8 px-3 border-neutral-700/80 text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800/65 hover:border-neutral-500`}
            >
              {props.copiedExample() === "unified" ? "Copied" : "Copy example"}
            </button>
          </div>
          <Show when={props.expandedExamples().unified}>
            <div class="px-4 pb-4">
              <pre class="w-full bg-neutral-950/75 border border-neutral-800 rounded-lg p-3 text-neutral-300 font-mono text-[12px] leading-relaxed overflow-x-auto">{unifiedExample}</pre>
            </div>
          </Show>
        </div>
      </div>

      <div class={`${settingsCls.subCard} p-4 space-y-3`}>
        <div>
          <p class="text-xs font-semibold text-neutral-200">Callback Secret Keys</p>
          <p class="text-xs text-neutral-500 mt-1">Send in header: <code>x-webhook-secret</code></p>
        </div>

        <Show when={props.webhookErrorMsg()}>
          <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm break-all">
            {props.webhookErrorMsg()}
          </div>
        </Show>

        <div class="flex flex-col sm:flex-row gap-3 items-stretch">
          <input
            type="text"
            placeholder="Optional key label (e.g. Production n8n)"
            value={props.webhookLabel()}
            onInput={(e) => props.setWebhookLabel(e.currentTarget.value)}
            class={`${settingsCls.field} flex-1`}
          />
          <button
            onClick={props.handleGenerateWebhookSecret}
            disabled={props.isGeneratingWebhookKey()}
            class={`${settingsCls.primaryBtn} whitespace-nowrap`}
          >
            {props.isGeneratingWebhookKey() ? "Generating..." : "Generate New Key"}
          </button>
        </div>

        <Show when={props.generatedWebhookSecret()}>
          <div class="p-4 rounded-xl border border-amber-500/25 bg-amber-500/8">
            <div class="text-sm text-amber-300 font-medium mb-2">Copy this key now. It is only shown once.</div>
            <code class="block w-full bg-neutral-950/75 border border-neutral-800 rounded-lg p-3 text-neutral-200 font-mono text-sm break-all">
              {props.generatedWebhookSecret()}
            </code>
            <div class="flex items-center gap-3 mt-3">
              <button
                onClick={props.handleCopyGeneratedWebhookSecret}
                class="text-xs bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 px-3 py-1.5 rounded-lg border border-amber-400/30 transition-colors"
              >
                {props.copiedWebhookSecret() ? "Copied" : "Copy Key"}
              </button>
              <button
                onClick={() => {
                  props.setGeneratedWebhookSecret("");
                  props.setCopiedWebhookSecret(false);
                }}
                class="text-xs text-neutral-300 hover:text-white px-2 py-1 rounded transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </Show>

        <div class="space-y-2.5">
          <Show when={props.activeWebhookSecrets().length === 0}>
            <div class={`${settingsCls.rowCard} px-4 py-3 text-sm text-neutral-500`}>
              No active callback keys yet. Generate a key to accept provider callbacks.
            </div>
          </Show>

          <For each={props.activeWebhookSecrets()}>
            {(secret) => (
              <div class={`${settingsCls.rowCard} px-4 py-3.5 flex items-start justify-between gap-4`}>
                <div class="min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-sm font-medium text-neutral-200 truncate">{secret.label}</span>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/12 border border-emerald-500/20 text-emerald-300">Active</span>
                  </div>
                  <div class="text-xs text-neutral-400 mb-2 font-mono">{secret.secretPrefix}...</div>
                  <div class="flex flex-col gap-0.5">
                    <p class="text-xs text-neutral-500">Created: {formatDate(secret.createdAt)}</p>
                    <p class="text-xs text-neutral-500">Last used: {formatDate(secret.lastUsedAt)}</p>
                  </div>
                </div>

                <button
                  onClick={() => props.requestRevokeWebhookSecret(secret.id)}
                  class={settingsCls.destructiveBtn}
                >
                  Revoke
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
