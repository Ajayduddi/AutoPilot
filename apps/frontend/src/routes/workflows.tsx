import { Title } from "@solidjs/meta";
import { createResource, createSignal, For, Show, createMemo, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { WorkflowListCard } from "../components/workflow/WorkflowListCard";
import { Button } from "../components/ui/Button";
import { CustomSelect } from "../components/ui/CustomSelect";
import { workflowsApi } from "../lib/api";
import { authTypeOptions, httpMethodOptions, providerFilterOptions as providers, providerOptions, triggerMethodOptions, visibilityOptions } from "../lib/workflow-form-options";

export default function Workflows() {
  const navigate = useNavigate();
  const [search, setSearch] = createSignal("");
  const [providerFilter, setProviderFilter] = createSignal("");
  const [visibilityFilter, setVisibilityFilter] = createSignal("");
  const [showArchived, setShowArchived] = createSignal(false);
  const [triggering, setTriggering] = createSignal<string | null>(null);
  const [showCreateForm, setShowCreateForm] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");
  onMount(() => {
    const saved = localStorage.getItem("wf-view-mode");
    if (saved === "list" || saved === "grid") setViewMode(saved);
  });
  function toggleView(mode: "grid" | "list") {
    setViewMode(mode);
    localStorage.setItem("wf-view-mode", mode);
  }
  const emptyForm = {
    key: "", name: "", description: "", provider: "n8n", visibility: "public",
    triggerMethod: "webhook", executionEndpoint: "", httpMethod: "POST", authType: "none", tags: "",
    enabled: true, requiresApproval: false,
    inputSchemaJson: "{}", outputSchemaJson: "{}",
    // Auth credential fields
    bearerToken: "", apiKeyName: "", apiKeyValue: "",
    headerName: "", headerSecret: "", customAuthJson: "{}",
  };
  const [form, setForm] = createSignal({ ...emptyForm });

  function updateField(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function buildAuthConfig(): Record<string, any> | undefined {
    const f = form();
    switch (f.authType) {
      case "bearer":  return f.bearerToken ? { token: f.bearerToken } : undefined;
      case "api_key":  return f.apiKeyValue ? { keyName: f.apiKeyName || "x-api-key", keyValue: f.apiKeyValue } : undefined;
      case "header_secret": return f.headerSecret ? { headerName: f.headerName || "x-secret", secret: f.headerSecret } : undefined;
      case "custom": try { const j = JSON.parse(f.customAuthJson); return Object.keys(j).length ? j : undefined; } catch { return undefined; }
      default: return undefined;
    }
  }

  async function handleCreate() {
    const f = form();
    if (!f.key || !f.name) { setCreateError("Key and name are required"); return; }
    setCreating(true);
    setCreateError(null);
    try {
      let inputSchema: any = undefined;
      let outputSchema: any = undefined;
      try {
        inputSchema = f.inputSchemaJson.trim() ? JSON.parse(f.inputSchemaJson) : undefined;
      } catch {
        setCreateError("Input Schema must be valid JSON"); return;
      }
      try {
        outputSchema = f.outputSchemaJson.trim() ? JSON.parse(f.outputSchemaJson) : undefined;
      } catch {
        setCreateError("Output Schema must be valid JSON"); return;
      }

      await workflowsApi.create({
        key: f.key,
        name: f.name,
        description: f.description || undefined,
        provider: f.provider,
        visibility: f.visibility,
        triggerMethod: f.triggerMethod,
        executionEndpoint: f.executionEndpoint || undefined,
        httpMethod: f.httpMethod,
        authType: f.authType,
        authConfig: buildAuthConfig(),
        enabled: f.enabled,
        requiresApproval: f.requiresApproval,
        inputSchema,
        outputSchema,
        tags: f.tags ? f.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      });
      setShowCreateForm(false);
      setForm({ ...emptyForm });
      await refetch();
    } catch (e: any) {
      setCreateError(e.message || "Failed to create workflow");
    } finally {
      setCreating(false);
    }
  }

  // Shared CSS classes
  const inputCls = "workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25 transition-colors";

  const filters = createMemo(() => ({
    provider: providerFilter() || undefined,
    visibility: visibilityFilter() || undefined,
    archived: showArchived() ? "true" : "false",
    search: search() || undefined,
  }));

  const [workflows, { refetch }] = createResource(filters, (f) => workflowsApi.getAll(f as any));

  async function handleTrigger(id: string) {
    setTriggering(id);
    try {
      await workflowsApi.trigger(id, { source: "ui", input: {} });
      await refetch();
    } catch (e: any) {
      console.error("Trigger failed:", e.message);
    } finally {
      setTriggering(null);
    }
  }

  const stats = createMemo(() => {
    const wfs = workflows() || [];
    return {
      total: wfs.length,
      enabled: wfs.filter((w: any) => w.enabled && !w.archived).length,
      byProvider: providers.slice(1).map(p => ({
        ...p,
        count: wfs.filter((w: any) => w.provider === p.value).length,
      })).filter(p => p.count > 0),
    };
  });

  return (
    <>
      <Title>Workflows — AutoPilot</Title>
      <main class="workflow-page flex-1 flex flex-col h-full min-w-0">
        {/* Header */}
        <header class="px-6 py-4 border-b border-neutral-800/20 bg-transparent shrink-0">
          <div class="workflow-shell flex items-center justify-between">
            <div>
              <h1 class="text-[14px] font-medium text-neutral-200 tracking-tight">Workflow Registry</h1>
              <p class="text-[12px] workflow-muted mt-1">Manage, trigger, and monitor your automations across all providers.</p>
            </div>
            <div class="flex items-center gap-3">
              <Show when={stats().byProvider.length > 0}>
                <div class="flex gap-1.5">
                  {stats().byProvider.map(p => (
                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-200 border border-slate-600/30">
                      {p.label}: {p.count}
                    </span>
                  ))}
                </div>
              </Show>
              <Button
                variant={showCreateForm() ? "ghost" : "primary"}
                size="sm"
                onClick={() => { setShowCreateForm(!showCreateForm()); setCreateError(null); }}
              >
                {showCreateForm() ? "✕ Cancel" : "+ Add Workflow"}
              </Button>
            </div>
          </div>
        </header>

        {/* Create Workflow Form */}
        <Show when={showCreateForm()}>
          <div class="px-6 py-4 border-b border-neutral-800/20 bg-neutral-900/20 block-enter">
            <div class="workflow-shell">
              <h3 class="text-sm font-semibold text-slate-100 mb-4">New Workflow</h3>
              <Show when={createError()}>
                <div class="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400 mb-4">
                  {createError()}
                </div>
              </Show>

              {/* Row 1: Key, Name, Provider, Visibility */}
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Key *</label>
                  <input placeholder="wf_my_flow" value={form().key} onInput={e => updateField("key", e.currentTarget.value)} class={inputCls} />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Name *</label>
                  <input placeholder="My Workflow" value={form().name} onInput={e => updateField("name", e.currentTarget.value)} class={inputCls} />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Provider</label>
                  <CustomSelect options={providerOptions} value={form().provider} onChange={v => updateField("provider", v)} />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Visibility</label>
                  <CustomSelect options={visibilityOptions} value={form().visibility} onChange={v => updateField("visibility", v)} />
                </div>
              </div>

              {/* Row 2: Trigger Method, Endpoint, HTTP Method, Auth Type */}
              <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Trigger Method</label>
                  <CustomSelect options={triggerMethodOptions} value={form().triggerMethod} onChange={v => updateField("triggerMethod", v)} />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Webhook / Execution URL</label>
                  <input placeholder="https://..." value={form().executionEndpoint} onInput={e => updateField("executionEndpoint", e.currentTarget.value)} class={inputCls} />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">HTTP Method</label>
                  <CustomSelect options={httpMethodOptions} value={form().httpMethod} onChange={v => updateField("httpMethod", v)} />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Auth Type</label>
                  <CustomSelect options={authTypeOptions} value={form().authType} onChange={v => updateField("authType", v)} />
                </div>
              </div>

              {/* Row 3: Dynamic Auth Credential Fields */}
              <Show when={form().authType !== "none"}>
                <div class="workflow-surface rounded-lg p-3 mb-3 block-enter">
                  <p class="text-[10px] uppercase tracking-wider workflow-muted mb-2">Authentication Details</p>

                  {/* Bearer */}
                  <Show when={form().authType === "bearer"}>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] workflow-muted">Bearer Token</label>
                      <input type="password" placeholder="Enter bearer token" value={form().bearerToken} onInput={e => updateField("bearerToken", e.currentTarget.value)} class={inputCls} />
                    </div>
                  </Show>

                  {/* API Key */}
                  <Show when={form().authType === "api_key"}>
                    <div class="grid grid-cols-2 gap-3">
                      <div class="flex flex-col gap-1">
                        <label class="text-[10px] workflow-muted">Header Name</label>
                        <input placeholder="x-api-key" value={form().apiKeyName} onInput={e => updateField("apiKeyName", e.currentTarget.value)} class={inputCls} />
                      </div>
                      <div class="flex flex-col gap-1">
                        <label class="text-[10px] workflow-muted">API Key Value</label>
                        <input type="password" placeholder="Enter API key" value={form().apiKeyValue} onInput={e => updateField("apiKeyValue", e.currentTarget.value)} class={inputCls} />
                      </div>
                    </div>
                  </Show>

                  {/* Header Secret */}
                  <Show when={form().authType === "header_secret"}>
                    <div class="grid grid-cols-2 gap-3">
                      <div class="flex flex-col gap-1">
                        <label class="text-[10px] workflow-muted">Header Name</label>
                        <input placeholder="x-secret" value={form().headerName} onInput={e => updateField("headerName", e.currentTarget.value)} class={inputCls} />
                      </div>
                      <div class="flex flex-col gap-1">
                        <label class="text-[10px] workflow-muted">Secret Value</label>
                        <input type="password" placeholder="Enter secret" value={form().headerSecret} onInput={e => updateField("headerSecret", e.currentTarget.value)} class={inputCls} />
                      </div>
                    </div>
                  </Show>

                  {/* Custom JSON */}
                  <Show when={form().authType === "custom"}>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] workflow-muted">Auth Config (JSON)</label>
                      <textarea rows={3} placeholder='{"header": "value"}' value={form().customAuthJson} onInput={e => updateField("customAuthJson", e.currentTarget.value)} class={inputCls + " font-mono text-xs resize-y"} />
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Row 4: Description, Tags */}
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div class="md:col-span-2 flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Description</label>
                  <textarea rows={3} placeholder="What does this workflow do? Provide complete info for the AI." value={form().description} onInput={e => updateField("description", e.currentTarget.value)} class={inputCls + " resize-y"} />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Tags</label>
                  <input placeholder="productivity, email" value={form().tags} onInput={e => updateField("tags", e.currentTarget.value)} class={inputCls} />
                </div>
              </div>

              {/* Row 5: Input Schema, Output Schema */}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Input Schema (JSON)</label>
                  <textarea rows={3} placeholder='{}' value={form().inputSchemaJson} onInput={e => updateField("inputSchemaJson", e.currentTarget.value)} class={inputCls + " font-mono text-xs resize-y"} />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-[10px] uppercase tracking-wider workflow-muted">Output Schema (JSON)</label>
                  <textarea rows={3} placeholder='{}' value={form().outputSchemaJson} onInput={e => updateField("outputSchemaJson", e.currentTarget.value)} class={inputCls + " font-mono text-xs resize-y"} />
                </div>
              </div>

              {/* Row 6: Toggles + Create */}
              <div class="flex items-center justify-between">
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, enabled: !prev.enabled }))}
                    class={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      form().enabled
                        ? "bg-neutral-200 text-neutral-900 border-neutral-200"
                        : "bg-neutral-900/60 text-neutral-300 border-neutral-700/70 hover:border-neutral-500"
                    }`}
                  >
                    Enabled
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, requiresApproval: !prev.requiresApproval }))}
                    class={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      form().requiresApproval
                        ? "bg-neutral-200 text-neutral-900 border-neutral-200"
                        : "bg-neutral-900/60 text-neutral-300 border-neutral-700/70 hover:border-neutral-500"
                    }`}
                  >
                    Requires Approval
                  </button>
                </div>
                <Button variant="primary" size="sm" disabled={creating()} onClick={handleCreate}>
                  {creating() ? "Creating…" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </Show>

        {/* Toolbar */}
        <div class="px-6 py-3 border-b border-slate-700/25 bg-black/10 shrink-0">
          <div class="workflow-shell flex flex-wrap items-center gap-3">
            {/* Search */}
            <div class="flex-1 min-w-[200px] max-w-sm relative">
              <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 workflow-dim" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                placeholder="Search workflows…"
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class="workflow-input w-full pl-8 pr-3 py-1.5 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25 transition-all"
              />
            </div>

            {/* Provider filter */}
            <select
              value={providerFilter()}
              onChange={(e) => setProviderFilter(e.currentTarget.value)}
              class="workflow-input px-3 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-neutral-500/90 cursor-pointer appearance-none"
            >
              {providers.map(p => (
                <option value={p.value}>{p.label}</option>
              ))}
            </select>

            {/* Visibility filter */}
            <select
              value={visibilityFilter()}
              onChange={(e) => setVisibilityFilter(e.currentTarget.value)}
              class="workflow-input px-3 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-neutral-500/90 cursor-pointer appearance-none"
            >
              <option value="">All Visibility</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>

            {/* Show archived toggle */}
            <label class="flex items-center gap-1.5 text-[11px] workflow-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived()}
                onChange={() => setShowArchived(!showArchived())}
                class="rounded border-neutral-700 bg-neutral-900 text-neutral-400 focus:ring-neutral-500/30 w-3.5 h-3.5"
              />
              Archived
            </label>

            {/* Stats pill */}
            <span class="text-[10px] workflow-dim ml-auto">
              {stats().total} workflow{stats().total !== 1 ? "s" : ""}
              {stats().enabled !== stats().total && ` (${stats().enabled} active)`}
            </span>

            {/* View toggle */}
            <div class="flex items-center gap-0.5 bg-neutral-800/60 border border-neutral-700/40 rounded-lg p-0.5">
              <button
                onClick={() => toggleView("grid")}
                title="Grid view"
                class={`flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150 ${
                  viewMode() === "grid"
                    ? "bg-neutral-600/80 text-slate-100 shadow-sm"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
              </button>
              <button
                onClick={() => toggleView("list")}
                title="List view"
                class={`flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150 ${
                  viewMode() === "list"
                    ? "bg-neutral-600/80 text-slate-100 shadow-sm"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto px-6 py-6">
          <Show when={workflows.loading}>
            <div class="workflow-shell flex items-center gap-2 text-sm workflow-muted py-8">
              <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Loading workflows…
            </div>
          </Show>

          <Show when={!workflows.loading}>
            {/* Empty state */}
            <Show when={(workflows() || []).length === 0}>
              <div class="workflow-shell text-center py-16">
                <div class="text-3xl mb-3">📋</div>
                <p class="text-slate-300 text-sm">No workflows match your filters.</p>
                <p class="workflow-dim text-xs mt-1">
                  Try adjusting your search or run <code class="text-blue-400">bun run db:seed</code> to add sample workflows.
                </p>
              </div>
            </Show>

            {/* Grid / List */}
            <div class={`workflow-shell ${
              viewMode() === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                : "flex flex-col gap-2"
            }`}>
              <For each={workflows() || []}>
                {(wf: any) => (
                  <WorkflowListCard
                    id={wf.id}
                    name={wf.name}
                    workflowKey={wf.key}
                    provider={wf.provider}
                    visibility={wf.visibility}
                    enabled={wf.enabled}
                    archived={wf.archived}
                    description={wf.description}
                    tags={wf.tags}
                    lastRunStatus={wf.lastRunStatus}
                    lastRunAt={wf.lastRunAt}
                    onTrigger={handleTrigger}
                    onViewDetails={(id) => navigate(`/workflows/${id}`)}
                    isTriggering={triggering() === wf.id}
                    layout={viewMode()}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </main>
    </>
  );
}
