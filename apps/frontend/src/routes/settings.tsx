import { Title } from "@solidjs/meta";
import { createSignal, createResource, Show, For } from "solid-js";
import { settingsApi } from "../lib/api";

export default function Settings() {
  const [providers, { refetch }] = createResource(() => settingsApi.getProviders());
  
  const [isAdding, setIsAdding] = createSignal(false);
  const [provider, setProvider] = createSignal("ollama");
  const [apiKey, setApiKey] = createSignal("");
  const [baseUrl, setBaseUrl] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");

  async function handleSave() {
    try {
      setSaving(true);
      setErrorMsg("");
      await settingsApi.saveProviderConfig({
        provider: provider(),
        model: "dynamic",
        apiKey: apiKey(),
        baseUrl: baseUrl(),
      });
      setIsAdding(false);
      resetForm();
      await refetch();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save provider config");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setProvider("ollama");
    setApiKey("");
    setBaseUrl("");
  }

  async function handleSetActive(id: string) {
    try {
      await settingsApi.setActiveProvider(id);
      await refetch();
    } catch (err: any) {
      alert("Error setting active provider: " + err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this connection?")) return;
    try {
      await settingsApi.deleteProvider(id);
      await refetch();
    } catch (err: any) {
      alert("Error deleting provider: " + err.message);
    }
  }

  return (
    <>
      <Title>Settings - Automation OS</Title>
      <main class="flex-1 flex flex-col relative h-full bg-[#111111]">
      
      <header class="px-6 py-4 border-b border-neutral-800/20 flex justify-between items-center">
        <div>
          <h1 class="text-[14px] font-medium text-neutral-200">Settings</h1>
          <p class="text-[12px] text-neutral-600 mt-1">Configure your integrations and agents.</p>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-6">
        <div class="max-w-3xl flex flex-col gap-8">
          
          <section>
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-sm font-medium text-neutral-300">Manage Direct Connections</h2>
              <Show when={!isAdding()}>
                <button 
                  onClick={() => setIsAdding(true)}
                  class="flex items-center gap-2 bg-neutral-900/60 hover:bg-neutral-800/60 text-neutral-300 px-3 py-1.5 rounded-lg text-[12px] transition-all duration-200 border border-neutral-800/40"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add Connection
                </button>
              </Show>
            </div>

            <Show when={!isAdding()}>
              <div class="flex flex-col gap-3">
                <Show when={providers()?.length === 0}>
                  <div class="bg-[#0e0e0e] p-6 rounded-xl border border-neutral-800/30 text-center flex flex-col items-center justify-center gap-2">
                    <span class="text-neutral-400 font-medium">No external connections configured.</span>
                    <span class="text-neutral-500 text-sm">By default, the system will use your local Ollama instance (http://localhost:11434) to handle requests.</span>
                  </div>
                </Show>
                <For each={providers()}>
                  {(conf) => (
                    <div class="bg-[#0e0e0e] rounded-xl border border-neutral-800/30 p-5 flex items-start justify-between">
                      <div class="flex flex-col">
                        <div class="flex items-center gap-3 mb-1">
                          <span class="font-medium text-neutral-100">{conf.provider.toUpperCase()}</span>
                          <Show when={conf.isDefault}>
                            <span class="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-emerald-500/20 text-emerald-400">Active</span>
                          </Show>
                        </div>
                        <Show when={conf.baseUrl}>
                          <span class="text-xs text-neutral-500 mt-1">{conf.baseUrl}</span>
                        </Show>
                      </div>
                      
                      <div class="flex items-center gap-2">
                        <Show when={!conf.isDefault}>
                          <button 
                            onClick={() => handleSetActive(conf.id)}
                            class="text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-400/10 px-3 py-1.5 rounded transition-colors"
                          >
                            Set Active
                          </button>
                        </Show>
                        <button 
                          onClick={() => handleDelete(conf.id)}
                          class="text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10 px-3 py-1.5 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={isAdding()}>
              <div class="bg-[#0e0e0e] rounded-xl border border-neutral-800/30 p-5 flex flex-col gap-4 shadow-lg">
                <div class="flex justify-between items-center mb-2">
                  <h3 class="font-medium text-neutral-100">Add New Connection</h3>
                  <button onClick={() => { setIsAdding(false); resetForm(); }} class="text-neutral-500 hover:text-neutral-300 p-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>

                <Show when={errorMsg()}>
                  <div class="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm break-all">
                    {errorMsg()}
                  </div>
                </Show>

                <div>
                  <label class="block text-sm font-medium text-neutral-400 mb-1">Provider ID</label>
                  <select 
                    value={provider()} 
                    onChange={(e) => { setProvider(e.currentTarget.value); }}
                    class="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-neutral-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="openai">OpenAI Compatible API</option>
                    <option value="ollama">Ollama (Local)</option>
                    <option value="mistral">Mistral</option>
                    <option value="gemini">Gemini</option>
                    <option value="groq">Groq</option>
                  </select>
                </div>

                <Show when={provider() === 'openai'}>
                  <div>
                    <label class="block text-sm font-medium text-neutral-400 mb-1">API Base URL</label>
                    <input 
                      type="text" 
                      placeholder="https://api.openai.com/v1" 
                      value={baseUrl()}
                      onInput={(e) => setBaseUrl(e.currentTarget.value)}
                      class="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-neutral-100 focus:outline-none focus:border-blue-500" 
                    />
                    <div class="text-xs text-neutral-500 mt-2 p-3 bg-neutral-900 rounded-lg border border-neutral-800">
                      <p class="font-medium text-neutral-400 mb-1.5">Common Compatible Base URLs:</p>
                      <ul class="list-disc pl-4 space-y-1">
                        <li>OpenAI: <code class="text-neutral-300">https://api.openai.com/v1</code></li>
                        <li>Groq: <code class="text-neutral-300">https://api.groq.com/openai/v1</code></li>
                        <li>Mistral: <code class="text-neutral-300">https://api.mistral.ai/v1</code></li>
                        <li>Local Ollama: <code class="text-neutral-300">http://localhost:11434/v1</code></li>
                      </ul>
                    </div>
                  </div>
                </Show>

                <div>
                  <label class="block text-sm font-medium text-neutral-400 mb-1">API Key (Bearer Auth)</label>
                  <input 
                    type="password" 
                    placeholder="sk-..." 
                    value={apiKey()}
                    onInput={(e) => setApiKey(e.currentTarget.value)}
                    class="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-neutral-100 focus:outline-none focus:border-blue-500" 
                  />
                </div>

                <div class="flex gap-3 mt-4">
                  <button 
                    onClick={handleSave}
                    disabled={saving()}
                    class={`bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 flex-1 rounded-lg transition-colors ${saving() ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {saving() ? 'Saving...' : 'Save Connection'}
                  </button>
                  <button 
                    onClick={() => { setIsAdding(false); resetForm(); }}
                    class="bg-neutral-800 hover:bg-neutral-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Show>
          </section>

          <section>
            <h2 class="text-sm font-medium text-neutral-300 mb-4">n8n Connection</h2>
            <div class="bg-[#0e0e0e] rounded-xl border border-neutral-800/30 p-5 flex flex-col gap-4">
              <div>
                <label class="block text-sm font-medium text-neutral-400 mb-1">Platform Inbound Webhook (Provide this to n8n)</label>
                <code class="block w-full bg-neutral-900 border border-neutral-800 rounded-lg p-3 text-neutral-300 font-mono text-sm">
                  http://localhost:3000/api/n8n/callback
                </code>
              </div>
            </div>
          </section>

        </div>
      </div>
    </main>
    </>
  );
}
