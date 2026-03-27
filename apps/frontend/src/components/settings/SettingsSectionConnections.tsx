import { For, Show, type Accessor } from "solid-js";
import { CustomSelect } from "../ui/CustomSelect";
import { providerLabel, providerSelectOptions, settingsCls } from "./types";

type ProviderConfig = {
  id: string;
  provider: string;
  baseUrl?: string | null;
  isDefault?: boolean;
};

export function SettingsSectionConnections(props: {
  providers: Accessor<ProviderConfig[]>;
  isAdding: Accessor<boolean>;
  setIsAdding: (value: boolean) => void;
  provider: Accessor<string>;
  setProvider: (value: string) => void;
  apiKey: Accessor<string>;
  setApiKey: (value: string) => void;
  baseUrl: Accessor<string>;
  setBaseUrl: (value: string) => void;
  saving: Accessor<boolean>;
  errorMsg: Accessor<string>;
  defaultModel: Accessor<string>;
  setDefaultModel: (value: string) => void;
  savingDefaultModel: Accessor<boolean>;
  defaultModelError: Accessor<string>;
  activeProviderConfig: Accessor<ProviderConfig | undefined>;
  activeProviderName: Accessor<string>;
  activeProviderModelsLoading: Accessor<boolean>;
  defaultModelOptions: Accessor<Array<{ value: string; label: string }>>;
  handleSave: () => void;
  resetForm: () => void;
  handleSaveDefaultModel: () => void;
  handleSetActive: (id: string) => void;
  requestDeleteProvider: (id: string) => void;
}) {
  return (
    <section class="space-y-4">
      <div
        class={`grid gap-4 items-start ${
          props.isAdding() ? "grid-cols-1 xl:grid-cols-[1.3fr_minmax(320px,1fr)]" : "grid-cols-1"
        }`}
      >
        <div class={`${settingsCls.sectionCard} p-5 space-y-3`}>
          <div class={`${settingsCls.subCard} p-4`}>
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <p class="text-sm font-semibold text-neutral-100">Default LLM Model</p>
                  <Show when={props.activeProviderConfig()}>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-medium border border-neutral-700/80 bg-neutral-900/80 text-neutral-300">
                      {props.activeProviderName()}
                    </span>
                  </Show>
                </div>
                <p class="text-xs text-neutral-500 mt-1">Used automatically when starting a new chat response.</p>
              </div>
            </div>

            <Show when={props.defaultModel()}>
              <div class="mt-3 inline-flex items-center gap-2 rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-2.5 py-1.5 text-[11px] text-neutral-400">
                <span>Current default</span>
                <span class="text-neutral-200 font-medium">
                  {props.activeProviderName()}: {props.defaultModel()}
                </span>
              </div>
            </Show>

            <div class="mt-3 rounded-xl border border-neutral-800/80 bg-neutral-950/55 p-2">
              <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Show
                  when={props.activeProviderConfig() && !props.activeProviderModelsLoading()}
                  fallback={
                    <div class={`${settingsCls.field} flex-1 flex items-center text-sm text-neutral-500`}>
                      {props.activeProviderModelsLoading() ? "Loading models..." : "Select an active connection first"}
                    </div>
                  }
                >
                  <CustomSelect
                    options={props.defaultModelOptions()}
                    value={props.defaultModel()}
                    onChange={props.setDefaultModel}
                    placeholder="Select model"
                    class="flex-1"
                    triggerClass="h-10 rounded-lg border-neutral-700/80 bg-neutral-900/90"
                    menuClass="rounded-lg border-neutral-700/80 bg-neutral-900/98 max-h-72 overflow-y-auto"
                  />
                </Show>
                <button
                  onClick={props.handleSaveDefaultModel}
                  disabled={!props.defaultModel() || props.savingDefaultModel() || !props.activeProviderConfig()}
                  class={`${settingsCls.primaryBtn} whitespace-nowrap min-w-[126px]`}
                >
                  {props.savingDefaultModel() ? "Saving..." : "Save default"}
                </button>
              </div>
            </div>

            <Show when={props.defaultModelError()}>
              <p class="text-xs text-red-400 mt-2">{props.defaultModelError()}</p>
            </Show>
          </div>

          <div class="space-y-2.5">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-sm font-semibold text-neutral-100">Direct Connections</h2>
                <p class="text-xs text-neutral-500 mt-1">Manage model providers and switch the active integration.</p>
              </div>
              <Show when={!props.isAdding()}>
                <button
                  onClick={() => props.setIsAdding(true)}
                  class={`${settingsCls.subtleBtn} border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-800/60 inline-flex items-center gap-2`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add Connection
                </button>
              </Show>
            </div>

            <Show when={props.providers().length === 0}>
              <div class={`${settingsCls.subCard} px-4 py-7 text-center`}>
                <p class="text-neutral-300 text-sm font-medium">No external connections configured.</p>
                <p class="text-neutral-500 text-xs mt-1">The app uses local Ollama by default.</p>
              </div>
            </Show>

            <For each={props.providers()}>
              {(conf) => (
                <div class={`${settingsCls.rowCard} px-4 py-3.5 flex items-start justify-between gap-4 hover:border-neutral-700/80 transition-colors`}>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2.5 mb-1">
                      <span class="font-medium text-neutral-100">{providerLabel(conf.provider || "")}</span>
                      <Show when={conf.isDefault}>
                        <span class="px-1.5 py-0.5 rounded-full text-[9px] leading-none uppercase tracking-[0.08em] font-semibold bg-emerald-500/15 border border-emerald-500/25 text-emerald-300">Active</span>
                      </Show>
                    </div>
                    <Show when={conf.baseUrl}>
                      <p class="text-xs text-neutral-500 font-mono break-all">{conf.baseUrl}</p>
                    </Show>
                  </div>

                  <div class="flex items-center gap-2 shrink-0">
                    <Show when={!conf.isDefault}>
                      <button
                        onClick={() => props.handleSetActive(conf.id)}
                        class={`${settingsCls.subtleBtn} border-indigo-500/30 text-indigo-300 hover:text-white hover:bg-indigo-500/18 hover:border-indigo-400/45`}
                      >
                        Set Active
                      </button>
                    </Show>
                    <button
                      onClick={() => props.requestDeleteProvider(conf.id)}
                      class={settingsCls.destructiveBtn}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        <Show when={props.isAdding()}>
          <div class={`${settingsCls.sectionCard} p-5 space-y-4 xl:sticky xl:top-6`}>
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold text-neutral-100">Add New Connection</h3>
              <button
                onClick={() => {
                  props.setIsAdding(false);
                  props.resetForm();
                }}
                class="text-neutral-500 hover:text-neutral-300 p-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <Show when={props.errorMsg()}>
              <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm break-all">
                {props.errorMsg()}
              </div>
            </Show>

            <div>
              <label class="block text-xs font-medium text-neutral-400 mb-1.5">Provider ID</label>
              <CustomSelect
                options={providerSelectOptions as unknown as Array<{ value: string; label: string }>}
                value={props.provider()}
                onChange={props.setProvider}
                class="w-full"
                triggerClass="h-10 rounded-lg border-neutral-700/80 bg-neutral-900/90"
                menuClass="rounded-lg border-neutral-700/80 bg-neutral-900/98"
              />
            </div>

            <Show when={props.provider() === "openai" || props.provider() === "ollama"}>
              <div>
                <label class="block text-xs font-medium text-neutral-400 mb-1.5">API Base URL</label>
                <input
                  type="text"
                  placeholder={props.provider() === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"}
                  value={props.baseUrl()}
                  onInput={(e) => props.setBaseUrl(e.currentTarget.value)}
                  class={settingsCls.field}
                />
                <div class="text-xs text-neutral-500 mt-2 p-3 bg-neutral-900/75 rounded-lg border border-neutral-800/80">
                  <p class="font-medium text-neutral-400 mb-1.5">Common compatible base URLs:</p>
                  <ul class="list-disc pl-4 space-y-1">
                    <li>Local Ollama: <code class="text-neutral-300">http://localhost:11434</code></li>
                    <li>Ollama Cloud: <code class="text-neutral-300">https://ollama.com</code></li>
                    <li>OpenAI: <code class="text-neutral-300">https://api.openai.com/v1</code></li>
                    <li>Groq: <code class="text-neutral-300">https://api.groq.com/openai/v1</code></li>
                    <li>Mistral: <code class="text-neutral-300">https://api.mistral.ai/v1</code></li>
                  </ul>
                </div>
              </div>
            </Show>

            <div>
              <label class="block text-xs font-medium text-neutral-400 mb-1.5">API Key (Bearer Auth)</label>
              <input
                type="password"
                placeholder="sk-..."
                value={props.apiKey()}
                onInput={(e) => props.setApiKey(e.currentTarget.value)}
                class={settingsCls.field}
              />
            </div>

            <div class="flex gap-2.5 pt-1">
              <button
                onClick={props.handleSave}
                disabled={props.saving()}
                class={`${settingsCls.primaryBtn} flex-1`}
              >
                {props.saving() ? "Saving..." : "Save Connection"}
              </button>
              <button
                onClick={() => {
                  props.setIsAdding(false);
                  props.resetForm();
                }}
                class={`${settingsCls.subtleBtn} border-neutral-700/80 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-800/60 h-10 px-4`}
              >
                Cancel
              </button>
            </div>
          </div>
        </Show>
      </div>
    </section>
  );
}
