import { For, Show, type Accessor } from "solid-js";
import { CustomSelect } from "../ui/CustomSelect";
import { providerLabel, providerSelectOptions, settingsCls } from "./types";

/**
  * provider config type alias.
  */
type ProviderConfig = {
  id: string;
  provider: string;
  customName?: string | null;
  baseUrl?: string | null;
  isDefault?: boolean;
};

/**
 * Utility function to settings section connections.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from SettingsSectionConnections.
 *
 * @example
 * ```typescript
 * const output = SettingsSectionConnections();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function SettingsSectionConnections(props: {
  providers: Accessor<ProviderConfig[]>;
  isAdding: Accessor<boolean>;
  setIsAdding: (value: boolean) => void;
  provider: Accessor<string>;
  setProvider: (value: string) => void;
  customName: Accessor<string>;
  setCustomName: (value: string) => void;
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
  defaultModelDisplayLabel: Accessor<string>;
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
    <section class={`${settingsCls.sectionCard} px-0 md:px-0 space-y-0 md:space-y-7`}>
      <div class="hidden md:block border-b border-neutral-800/40 pb-4">
        <h2 class="text-xl font-semibold text-neutral-100 tracking-tight">Connections</h2>
        <p class="text-[14px] text-neutral-500 mt-1">Manage external AI providers and configure your default system model.</p>
      </div>

      <div
        class={`grid gap-6 items-start ${
          props.isAdding() ? "grid-cols-1 xl:grid-cols-[1.3fr_minmax(340px,1fr)]" : "grid-cols-1"
        }`}
      >
        <div class="flex flex-col md:space-y-6 divide-y divide-neutral-800/60 md:divide-none">
          <div class={`${settingsCls.subCard} px-4 py-5 md:p-5`}>
            <div class="mb-4">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <p class="text-[14px] sm:text-[15px] font-medium text-neutral-200 tracking-tight">Default LLM Model</p>
                  <Show when={props.activeProviderConfig()}>
                    <span class="px-2 py-[2px] rounded-md text-[9px] uppercase tracking-wider font-semibold border border-neutral-700/60 bg-neutral-800/40 text-neutral-300">
                      {props.activeProviderName()}
                    </span>
                  </Show>
                </div>
              </div>
              <p class="text-[12px] sm:text-[13px] text-neutral-500 mt-1">Used automatically when starting a new chat.</p>
            </div>

            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Show
                when={props.activeProviderConfig() && !props.activeProviderModelsLoading()}
                fallback={
                  <div class="flex-1 flex items-center text-[12px] text-neutral-500 h-10 rounded-xl border border-neutral-700/40 bg-[#121212] px-4">
                    {props.activeProviderModelsLoading() ? (
                      <span class="flex items-center gap-2">
                        <span class="w-3 h-3 border-2 border-neutral-600 border-t-neutral-400 rounded-full animate-spin" />
                        Loading...
                      </span>
                    ) : "Select an active connection first"}
                  </div>
                }
              >
                <CustomSelect
                  options={props.defaultModelOptions()}
                  value={props.defaultModel()}
                  onChange={props.setDefaultModel}
                  placeholder="Select model"
                  class="flex-1 min-w-[200px]"
                  triggerClass="h-10 px-4 rounded-xl border-neutral-700/60 bg-[#121212] text-[13px] hover:border-neutral-600"
                  menuClass="rounded-xl border-neutral-700/80 bg-neutral-900/98 max-h-72 overflow-y-auto"
                />
              </Show>
              
              <button
                onClick={props.handleSaveDefaultModel}
                disabled={!props.defaultModel() || props.savingDefaultModel() || !props.activeProviderConfig()}
                class={`flex items-center justify-center gap-2 h-10 px-5 rounded-xl text-[13px] font-medium transition-colors shrink-0 ${
                  !props.defaultModel() || props.activeProviderModelsLoading()
                    ? "bg-neutral-800/30 text-neutral-500 cursor-not-allowed border border-transparent"
                    : "bg-white hover:bg-neutral-100 text-black shadow-sm active:scale-[0.98]"
                }`}
              >
                <Show when={props.savingDefaultModel()} fallback={
                  <><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> <span>Save</span></>
                }>
                  <div class="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  <span>Saving</span>
                </Show>
              </button>
            </div>
            
            <Show when={props.defaultModel()}>
              <div class="mt-2.5 flex items-center gap-1.5 text-[11px] text-neutral-500 pl-1">
                <svg class="w-3 h-3 text-emerald-500/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                Current: <span class="text-neutral-300 ml-0.5 max-w-[220px] truncate">{props.defaultModelDisplayLabel()}</span>
              </div>
            </Show>

            <Show when={props.defaultModelError()}>
              <p class="text-xs text-red-400 mt-2">{props.defaultModelError()}</p>
            </Show>
          </div>

          <div class={`${settingsCls.subCard} px-4 py-5 md:p-5 space-y-4`}>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-[15px] font-medium text-neutral-200 tracking-tight">Direct Connections</p>
                <p class="text-[13px] text-neutral-500 mt-0.5">Manage model providers and switch the active integration.</p>
              </div>
              <Show when={!props.isAdding()}>
                <button
                  onClick={() => props.setIsAdding(true)}
                  class={`${settingsCls.subtleBtn} flex items-center justify-center p-2 sm:px-3 sm:py-2 gap-2`}
                  title="Add Connection"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  <span class="hidden sm:inline">Add Connection</span>
                </button>
              </Show>
            </div>

            <Show when={props.providers().length === 0}>
              <div class="rounded-2xl border border-dashed border-neutral-800/80 bg-neutral-900/20 px-4 py-8 text-center">
                <p class="text-neutral-300 text-sm font-medium">No external connections configured.</p>
                <p class="text-neutral-500 text-[13px] mt-1">The app uses local Ollama by default.</p>
              </div>
            </Show>

            <div class="space-y-3">
              <For each={props.providers()}>
                {(conf) => (
                  <div class={`${settingsCls.rowCard} px-4 py-3.5 md:px-4 md:py-3 flex flex-row items-center justify-between gap-3 transition-colors bg-white/[0.03] md:bg-white/[0.02] hover:bg-white/[0.05] !rounded-xl border border-neutral-800/25 md:border-neutral-800/50 mb-3 md:mb-0`}>
                    <div class="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                      <div class="flex items-center gap-2">
                        <span class="text-[14px] font-medium text-neutral-100">
                          {conf.customName?.trim() || providerLabel(conf.provider || "")}
                        </span>
                        <Show when={Boolean(conf.customName?.trim())}>
                          <span class="px-1.5 py-0.5 rounded-md text-[9px] leading-none uppercase tracking-wider font-bold bg-neutral-700/25 border border-neutral-700/60 text-neutral-300">
                            {providerLabel(conf.provider || "")}
                          </span>
                        </Show>
                        <Show when={conf.isDefault}>
                          <span class="px-1.5 py-0.5 rounded-md text-[9px] leading-none uppercase tracking-wider font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">Active</span>
                        </Show>
                      </div>
                      <Show when={conf.baseUrl}>
                        <span class="hidden sm:block text-neutral-700/50 text-[10px]">•</span>
                        <p class="text-[11px] text-neutral-500 font-mono break-all line-clamp-1">{conf.baseUrl}</p>
                      </Show>
                    </div>

                    <div class="flex items-center gap-1 shrink-0">
                      <Show when={!conf.isDefault}>
                        <button
                          onClick={() => props.handleSetActive(conf.id)}
                          class="p-1.5 sm:p-2 rounded-lg text-indigo-400/70 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
                          title="Set as active provider"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </button>
                      </Show>
                      <button
                        onClick={() => props.requestDeleteProvider(conf.id)}
                        class="p-1.5 sm:p-2 rounded-lg text-red-500/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete connection"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M3 6h18"></path>
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        <Show when={props.isAdding()}>
          <div class={`${settingsCls.subCard} px-4 py-5 md:p-5 space-y-5 xl:sticky xl:top-24`}>
            <div class="flex items-center justify-between border-b border-neutral-800/50 pb-3">
              <h3 class="text-[15px] font-medium text-neutral-200 tracking-tight">Add New Connection</h3>
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

            <div class="space-y-1.5">
              <label class="text-[12px] font-medium text-neutral-400 pl-1">Provider ID</label>
              <CustomSelect
                options={providerSelectOptions as unknown as Array<{ value: string; label: string }>}
                value={props.provider()}
                onChange={props.setProvider}
                class="w-full"
                triggerClass="h-11 rounded-xl border-neutral-800 bg-[#1a1a1a]"
                menuClass="rounded-xl border-neutral-800 bg-[#1a1a1a]"
              />
            </div>

            <Show when={props.provider() === "openai"}>
              <div class="space-y-1.5">
                <label class="text-[12px] font-medium text-neutral-400 pl-1">Custom Connection Name (Optional)</label>
                <input
                  type="text"
                  maxlength={80}
                  placeholder="NVIDIA - DeepSeek V3.2"
                  value={props.customName()}
                  onInput={(e) => props.setCustomName(e.currentTarget.value)}
                  class={settingsCls.field}
                />
              </div>
            </Show>

            <Show when={props.provider() === "openai" || props.provider() === "ollama"}>
              <div class="space-y-1.5">
                <label class="text-[12px] font-medium text-neutral-400 pl-1">API Base URL</label>
                <input
                  type="text"
                  placeholder={props.provider() === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"}
                  value={props.baseUrl()}
                  onInput={(e) => props.setBaseUrl(e.currentTarget.value)}
                  class={settingsCls.field}
                />
                <div class="text-[12px] text-neutral-500 mt-2 p-3 bg-neutral-900/40 rounded-xl border border-neutral-800/60">
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

            <div class="space-y-1.5">
              <label class="text-[12px] font-medium text-neutral-400 pl-1">API Key (Bearer Auth)</label>
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
                class={`${settingsCls.primaryBtn} flex items-center justify-center gap-2 flex-1`}
              >
                <Show when={props.saving()} fallback={
                  <><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> <span>Save Connection</span></>
                }>
                  <div class="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  <span>Saving...</span>
                </Show>
              </button>
              <button
                onClick={() => {
                  props.setIsAdding(false);
                  props.resetForm();
                }}
                class={`${settingsCls.subtleBtn} flex items-center justify-center`}
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
