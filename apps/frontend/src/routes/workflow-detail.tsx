import { Title } from "@solidjs/meta";
import { useParams, useNavigate } from "@solidjs/router";
import { createResource, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { workflowsApi, notificationsApi } from "../lib/api";
import { useMobileMenu } from "../context/mobile-menu.context";
import { Button } from "../components/ui/Button";
import { CustomSelect } from "../components/ui/CustomSelect";
import {
  authTypeOptions as authTypeSelectOptions,
  httpMethodOptions as httpMethodSelectOptions,
  providerLabels,
  providerOptions as providerSelectOptions,
  triggerMethodOptions as triggerMethodSelectOptions,
  visibilityOptions as visibilitySelectOptions,
} from "../lib/workflow-form-options";
const providerNotes: Record<string, string> = {
  n8n: "Supports deep execution tracing, sub-workflows, and complex polling.",
  zapier: "Broadest app ecosystem. Best for simple A-to-B automations.",
  make: "Visual scenario builder, great for multi-path routing.",
  custom: "Internal code execution via webhooks.",
  sim: "Simulated environment for local testing without external API calls.",
};
const statusColors: Record<string, string> = {
  completed: "text-emerald-400",
  running: "text-blue-400",
  failed: "text-red-400",
  queued: "text-neutral-300",
  waiting_approval: "text-amber-400",
};
const statusDots: Record<string, string> = {
  completed: "bg-emerald-500",
  running: "bg-blue-500 animate-pulse",
  failed: "bg-red-500",
  queued: "bg-neutral-500 animate-pulse",
  waiting_approval: "bg-amber-500 animate-pulse",
};


export default function WorkflowDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const mobileMenu = useMobileMenu();
  const [workflow, { refetch: refetchWorkflow }] = createResource(() => params.id, (id) => workflowsApi.getById(id));
  const [runs, { refetch: refetchRuns }] = createResource(
    () => params.id,
    (id) => workflowsApi.getRuns(id, { limit: 20 }),
  );

  const [triggering, setTriggering] = createSignal(false);
  const [triggerResult, setTriggerResult] = createSignal<any>(null);
  const [expandedRun, setExpandedRun] = createSignal<string | null>(null);
  const [runDetail, setRunDetail] = createSignal<any>(null);
  const [showInputForm, setShowInputForm] = createSignal(false);
  const [inputJson, setInputJson] = createSignal("{}");
  const [showEditForm, setShowEditForm] = createSignal(false);
  const [showDeleteModal, setShowDeleteModal] = createSignal(false);
  const [savingEdit, setSavingEdit] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [editError, setEditError] = createSignal<string | null>(null);
  const [editForm, setEditForm] = createSignal({
    key: "",
    name: "",
    description: "",
    provider: "n8n",
    visibility: "public",
    archived: false,
    enabled: true,
    requiresApproval: false,
    triggerMethod: "webhook",
    executionEndpoint: "",
    httpMethod: "POST",
    authType: "none",
    authBearerToken: "",
    authApiKeyName: "x-api-key",
    authApiKeyValue: "",
    authHeaderName: "x-secret",
    authHeaderSecret: "",
    authCustomJson: "{}",
    inputSchemaJson: "{}",
    outputSchemaJson: "{}",
    tags: "",
  });
  let sse: EventSource | undefined;

  onMount(() => {
    sse = notificationsApi.openStream();
    sse.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "workflow_update" && msg.data?.workflowId === params.id) {
          refetchRuns();
          refetchWorkflow();
          if (expandedRun() === msg.data?.id) loadRunDetail(msg.data.id);
        }
      } catch { /* ignore */ }
    };
  });

  onCleanup(() => sse?.close());

  /**
   * Utility function to handle trigger.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleTrigger.
   *
   * @example
   * ```typescript
   * const output = handleTrigger();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleTrigger() {
    setTriggering(true);
    setTriggerResult(null);
    try {
      let input = {};
      try { input = JSON.parse(inputJson()); } catch { input = {}; }
      const result = await workflowsApi.trigger(params.id, { source: "ui", input });
      setTriggerResult(result);
      setShowInputForm(false);
      await refetchRuns();
      await refetchWorkflow();
    } catch (e: any) {
      setTriggerResult({ error: e.message });
    } finally {
      setTriggering(false);
    }
  }

  /**
   * Utility function to open edit form.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from openEditForm.
   *
   * @example
   * ```typescript
   * const output = openEditForm();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function openEditForm() {
    const wf = workflow() as any;
    if (!wf) return;
    setEditError(null);
    const authConfig = (wf.authConfig ?? {}) as Record<string, any>;
    setEditForm({
      key: wf.key || "",
      name: wf.name || "",
      description: wf.description || "",
      provider: wf.provider || "n8n",
      visibility: wf.visibility || "public",
      archived: !!wf.archived,
      enabled: !!wf.enabled,
      requiresApproval: !!wf.requiresApproval,
      triggerMethod: wf.triggerMethod || "webhook",
      executionEndpoint: wf.executionEndpoint || "",
      httpMethod: wf.httpMethod || "POST",
      authType: wf.authType || "none",
      authBearerToken: authConfig.token ?? "",
      authApiKeyName: authConfig.keyName ?? "x-api-key",
      authApiKeyValue: authConfig.keyValue ?? "",
      authHeaderName: authConfig.headerName ?? "x-secret",
      authHeaderSecret: authConfig.secret ?? "",
      authCustomJson: JSON.stringify(authConfig, null, 2),
      inputSchemaJson: JSON.stringify(wf.inputSchema ?? {}, null, 2),
      outputSchemaJson: JSON.stringify(wf.outputSchema ?? {}, null, 2),
      tags: Array.isArray(wf.tags) ? wf.tags.join(", ") : "",
    });
    setShowEditForm(true);
  }

  /**
   * Utility function to handle save edit.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleSaveEdit.
   *
   * @example
   * ```typescript
   * const output = handleSaveEdit();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleSaveEdit() {
    setSavingEdit(true);
    setEditError(null);
    try {
      const form = editForm();
      if (!form.name.trim()) {
        setEditError("Name is required");
        return;
      }
      if (!form.key.trim()) {
        setEditError("Key is required");
        return;
      }
      let inputSchema: any = null;
      let outputSchema: any = null;
      try {
        inputSchema = form.inputSchemaJson.trim() ? JSON.parse(form.inputSchemaJson) : null;
      } catch {
        setEditError("Input Schema must be valid JSON");
        return;
      }
      try {
        outputSchema = form.outputSchemaJson.trim() ? JSON.parse(form.outputSchemaJson) : null;
      } catch {
        setEditError("Output Schema must be valid JSON");
        return;
      }
      let authConfig: Record<string, any> | null = null;
      switch (form.authType) {
        case "bearer":
          authConfig = form.authBearerToken.trim() ? { token: form.authBearerToken.trim() } : null;
          break;
        case "api_key":
          authConfig = form.authApiKeyValue.trim()
            ? {
              keyName: form.authApiKeyName.trim() || "x-api-key",
              keyValue: form.authApiKeyValue.trim(),
            }
            : null;
          break;
        case "header_secret":
          authConfig = form.authHeaderSecret.trim()
            ? {
              headerName: form.authHeaderName.trim() || "x-secret",
              secret: form.authHeaderSecret.trim(),
            }
            : null;
          break;
        case "custom":
          try {
            const parsed = form.authCustomJson.trim() ? JSON.parse(form.authCustomJson) : {};
            authConfig = Object.keys(parsed).length ? parsed : null;
          } catch {
            setEditError("Custom Auth JSON must be valid JSON");
            return;
          }
          break;
        default:
          authConfig = null;
      }
      const payload: Record<string, any> = {
        key: form.key.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        provider: form.provider,
        visibility: form.visibility,
        archived: form.archived,
        enabled: form.enabled,
        requiresApproval: form.requiresApproval,
        triggerMethod: form.triggerMethod,
        executionEndpoint: form.executionEndpoint.trim() || null,
        httpMethod: form.httpMethod,
        authType: form.authType,
        authConfig,
        inputSchema,
        outputSchema,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };

      await workflowsApi.update(params.id, payload);
      setShowEditForm(false);
      await refetchWorkflow();
      await refetchRuns();
    } catch (e: any) {
      setEditError(e.message || "Failed to update workflow");
    } finally {
      setSavingEdit(false);
    }
  }

  /**
   * Utility function to handle delete workflow.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleDeleteWorkflow.
   *
   * @example
   * ```typescript
   * const output = handleDeleteWorkflow();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleDeleteWorkflow() {
    setDeleting(true);
    setEditError(null);
    try {
      await workflowsApi.delete(params.id, "hard");
      setShowDeleteModal(false);
      navigate("/workflows");
    } catch (e: any) {
      setEditError(e.message || "Failed to delete workflow");
    } finally {
      setDeleting(false);
    }
  }

  /**
   * Utility function to load run detail.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param runId - Input value for loadRunDetail.
   * @returns Return value from loadRunDetail.
   *
   * @example
   * ```typescript
   * const output = loadRunDetail(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function loadRunDetail(runId: string) {
    if (expandedRun() === runId) {
      setExpandedRun(null);
      setRunDetail(null);
      return;
    }
    setExpandedRun(runId);
    try {
      const detail = await workflowsApi.getRunById(runId, true);
      setRunDetail(detail);
    } catch (e) {
      setRunDetail({ error: "Failed to load run details" });
    }
  }
  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleString();
  };

  return (
    <>
      <Title>{workflow()?.name || "Workflow"} — AutoPilot</Title>
      <main class="workflow-page flex-1 flex flex-col h-full min-w-0">
        {/* Header */}
        <header class="px-6 py-4 border-b border-slate-700/30 bg-black/15 shrink-0">
          <div class="workflow-shell">
            <button
              onClick={() => navigate("/workflows")}
              class="text-xs workflow-muted hover:text-slate-100 transition-colors flex items-center gap-1 mb-3"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              Back to Workflows
            </button>

            <Show when={workflow()} fallback={
              <div class="flex items-center gap-2 text-sm text-neutral-300">
                <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Loading…
              </div>
            }>
              {(wf) => (
                <div class={`flex flex-col md:flex-row md:items-start justify-between gap-4 ${showEditForm() ? "hidden md:flex" : ""}`}>
                  <div class="flex items-start gap-3">

                    <div>
                      <div class="flex flex-wrap items-center gap-2.5">
                      <h1 class="page-title">{(wf() as any).name}</h1>
                      <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800/70 border border-slate-600/35 text-slate-100">
                        {providerLabels[(wf() as any).provider] || (wf() as any).provider}
                      </span>
                      <Show when={(wf() as any).visibility === "private"}>
                        <span class="text-[10px] text-neutral-400 flex items-center gap-0.5">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                          Private
                        </span>
                      </Show>
                    </div>
                    <p class="text-xs text-slate-300 font-mono mt-1">{(wf() as any).key}</p>
                    <Show when={(wf() as any).description}>
                      <p class="text-sm text-slate-200 mt-2 max-w-2xl leading-relaxed">{(wf() as any).description}</p>
                    </Show>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 px-3 rounded-lg border border-slate-600/35 bg-slate-800/30 text-slate-100 hover:bg-slate-700/35"
                      onClick={openEditForm}
                    >
                      <span class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        Edit
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 px-3 rounded-lg border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200"
                      disabled={deleting()}
                      onClick={() => setShowDeleteModal(true)}
                    >
                      <span class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                        Delete
                      </span>
                    </Button>
                    <Show when={(wf() as any).enabled && !(wf() as any).archived}>
                      <Button
                        variant="primary"
                        size="sm"
                        class="h-8 px-3 rounded-lg shadow-[0_6px_18px_rgba(37,99,235,0.35)]"
                        disabled={triggering()}
                        onClick={() => { showInputForm() ? handleTrigger() : setShowInputForm(true); }}
                      >
                        {triggering() ? (
                          <span class="flex items-center gap-1.5">
                            <div class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Triggering…
                          </span>
                        ) : showInputForm() ? (
                          <span class="flex items-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg> Execute
                          </span>
                        ) : (
                          <span class="flex items-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg> Trigger
                          </span>
                        )}
                      </Button>
                      <Show when={showInputForm()}>
                        <Button variant="ghost" size="sm" onClick={() => setShowInputForm(false)}>Cancel</Button>
                      </Show>
                    </Show>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </header>

        {/* Content */}
        <div class="flex-1 overflow-y-auto px-6 py-6">
          <div class="workflow-shell space-y-6">

            {/* Edit form */}
            <Show when={showEditForm()}>
              <div class="md:workflow-surface md:rounded-xl md:p-4 mb-5 block-enter">
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-semibold text-slate-100">Edit Workflow</h3>
                  <div class="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setShowEditForm(false); setEditError(null); }}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" disabled={savingEdit()} onClick={handleSaveEdit}>
                      {savingEdit() ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </div>

                <Show when={editError()}>
                  <div class="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400 mb-3">
                    {editError()}
                  </div>
                </Show>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Key</label>
                    <input
                      value={editForm().key}
                      onInput={(e) => setEditForm((prev) => ({ ...prev, key: e.currentTarget.value }))}
                      class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Name</label>
                    <input
                      value={editForm().name}
                      onInput={(e) => setEditForm((prev) => ({ ...prev, name: e.currentTarget.value }))}
                      class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                    />
                  </div>

                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Provider</label>
                    <CustomSelect
                      options={providerSelectOptions}
                      value={editForm().provider}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, provider: value }))}
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Visibility</label>
                    <CustomSelect
                      options={visibilitySelectOptions}
                      value={editForm().visibility}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, visibility: value }))}
                    />
                  </div>

                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Trigger Method</label>
                    <CustomSelect
                      options={triggerMethodSelectOptions}
                      value={editForm().triggerMethod}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, triggerMethod: value }))}
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Auth Type</label>
                    <CustomSelect
                      options={authTypeSelectOptions}
                      value={editForm().authType}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, authType: value }))}
                    />
                  </div>

                  <Show when={editForm().authType === "bearer"}>
                    <div class="md:col-span-2 flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Bearer Token</label>
                      <input
                        type="password"
                        value={editForm().authBearerToken}
                        onInput={(e) => setEditForm((prev) => ({ ...prev, authBearerToken: e.currentTarget.value }))}
                        class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                      />
                    </div>
                  </Show>

                  <Show when={editForm().authType === "api_key"}>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">API Key Header</label>
                      <input
                        value={editForm().authApiKeyName}
                        onInput={(e) => setEditForm((prev) => ({ ...prev, authApiKeyName: e.currentTarget.value }))}
                        class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                      />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">API Key Value</label>
                      <input
                        type="password"
                        value={editForm().authApiKeyValue}
                        onInput={(e) => setEditForm((prev) => ({ ...prev, authApiKeyValue: e.currentTarget.value }))}
                        class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                      />
                    </div>
                  </Show>

                  <Show when={editForm().authType === "header_secret"}>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Header Name</label>
                      <input
                        value={editForm().authHeaderName}
                        onInput={(e) => setEditForm((prev) => ({ ...prev, authHeaderName: e.currentTarget.value }))}
                        class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                      />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Header Secret</label>
                      <input
                        type="password"
                        value={editForm().authHeaderSecret}
                        onInput={(e) => setEditForm((prev) => ({ ...prev, authHeaderSecret: e.currentTarget.value }))}
                        class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                      />
                    </div>
                  </Show>

                  <Show when={editForm().authType === "custom"}>
                    <div class="md:col-span-2 flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Custom Auth JSON</label>
                      <textarea
                        rows={3}
                        value={editForm().authCustomJson}
                        onInput={(e) => setEditForm((prev) => ({ ...prev, authCustomJson: e.currentTarget.value }))}
                        class="workflow-input px-3 py-2 rounded-lg border text-xs font-mono focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25 resize-y"
                      />
                    </div>
                  </Show>

                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Execution Endpoint</label>
                    <input
                      value={editForm().executionEndpoint}
                      onInput={(e) => setEditForm((prev) => ({ ...prev, executionEndpoint: e.currentTarget.value }))}
                      class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">HTTP Method</label>
                    <CustomSelect
                      options={httpMethodSelectOptions}
                      value={editForm().httpMethod}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, httpMethod: value }))}
                    />
                  </div>

                  <div class="md:col-span-2 flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Description</label>
                    <textarea
                      rows={3}
                      value={editForm().description}
                      onInput={(e) => setEditForm((prev) => ({ ...prev, description: e.currentTarget.value }))}
                      class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25 resize-y"
                    />
                  </div>

                  <div class="md:col-span-2 flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Tags (comma-separated)</label>
                    <input
                      value={editForm().tags}
                      onInput={(e) => setEditForm((prev) => ({ ...prev, tags: e.currentTarget.value }))}
                      class="workflow-input px-3 py-2 rounded-lg border text-sm focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25"
                    />
                  </div>

                  <div class="md:col-span-2 flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Input Schema (JSON)</label>
                    <textarea
                      rows={3}
                      value={editForm().inputSchemaJson}
                      onInput={(e) => setEditForm((prev) => ({ ...prev, inputSchemaJson: e.currentTarget.value }))}
                      class="workflow-input px-3 py-2 rounded-lg border text-xs font-mono focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25 resize-y"
                    />
                  </div>

                  <div class="md:col-span-2 flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Output Schema (JSON)</label>
                    <textarea
                      rows={3}
                      value={editForm().outputSchemaJson}
                      onInput={(e) => setEditForm((prev) => ({ ...prev, outputSchemaJson: e.currentTarget.value }))}
                      class="workflow-input px-3 py-2 rounded-lg border text-xs font-mono focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25 resize-y"
                    />
                  </div>

                  <div class="md:col-span-2 flex flex-wrap gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
                      class={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${editForm().enabled
                          ? "bg-neutral-200 text-neutral-900 border-neutral-200"
                          : "bg-neutral-900/60 text-neutral-300 border-neutral-700/70 hover:border-neutral-500"
                        }`}
                    >
                      Enabled
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, archived: !prev.archived }))}
                      class={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${editForm().archived
                          ? "bg-neutral-200 text-neutral-900 border-neutral-200"
                          : "bg-neutral-900/60 text-neutral-300 border-neutral-700/70 hover:border-neutral-500"
                        }`}
                    >
                      Archived
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, requiresApproval: !prev.requiresApproval }))}
                      class={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${editForm().requiresApproval
                          ? "bg-neutral-200 text-neutral-900 border-neutral-200"
                          : "bg-neutral-900/60 text-neutral-300 border-neutral-700/70 hover:border-neutral-500"
                        }`}
                    >
                      Requires Approval
                    </button>
                  </div>

                </div>
              </div>
            </Show>

            {/* Delete confirmation modal */}
            <Show when={showDeleteModal() && workflow()}>
              <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-[2px] px-4">
                <div class="workflow-surface w-full max-w-md rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.55)] p-5">
                  <div class="flex items-start gap-3">
                    <div class="w-8 h-8 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center text-red-300 shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    </div>
                    <div>
                      <h3 class="text-sm font-semibold text-slate-100">Delete Workflow?</h3>
                      <p class="text-xs text-slate-300 mt-1 leading-relaxed">
                        This will permanently delete <span class="text-slate-100 font-medium">{(workflow() as any).name}</span> and its related configuration.
                        This action cannot be undone.
                      </p>
                    </div>
                  </div>

                  <div class="mt-4 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 px-3 rounded-lg border border-slate-600/35 bg-slate-800/30 text-slate-200 hover:bg-slate-700/35"
                      disabled={deleting()}
                      onClick={() => setShowDeleteModal(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 px-3 rounded-lg border border-red-500/30 bg-red-500/15 text-red-200 hover:bg-red-500/25"
                      disabled={deleting()}
                      onClick={handleDeleteWorkflow}
                    >
                      {deleting() ? "Deleting..." : "Delete Permanently"}
                    </Button>
                  </div>
                </div>
              </div>
            </Show>

            {/* Trigger result banner */}
            <Show when={triggerResult()}>
              <div class={`rounded-lg border px-4 py-3 text-xs ${triggerResult()?.error ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"}`}>
                {triggerResult()?.error ? `Error: ${triggerResult().error}` : `Run dispatched — ID: ${triggerResult()?.runId || "queued"}`}
              </div>
            </Show>

            {/* Input form */}
            <Show when={showInputForm()}>
              <div class="workflow-surface rounded-xl p-4 block-enter">
                <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-400 mb-2">Input Payload (JSON)</p>
                <textarea
                  value={inputJson()}
                  onInput={(e) => setInputJson(e.currentTarget.value)}
                  rows={5}
                  class="workflow-input w-full rounded-lg border text-sm font-mono p-3 focus:outline-none focus:border-blue-400/60 focus:ring-1 focus:ring-blue-500/25 resize-y"
                  placeholder='{"key": "value"}'
                />
              </div>
            </Show>

            {/* Metadata grid */}
            <Show when={workflow()}>
              {(wf) => (
                <div class={`grid grid-cols-2 md:grid-cols-4 gap-3 ${showEditForm() ? "hidden md:grid" : ""}`}>
                  {[
                    { label: "Provider", value: providerLabels[(wf() as any).provider] || (wf() as any).provider },
                    { label: "Visibility", value: (wf() as any).visibility },
                    { label: "Trigger", value: (wf() as any).triggerMethod || "webhook" },
                    { label: "HTTP Method", value: (wf() as any).httpMethod || "POST" },
                    { label: "Auth", value: (wf() as any).authType || "none" },
                    { label: "Enabled", value: (wf() as any).enabled ? "Yes" : "No" },
                    { label: "Requires Approval", value: (wf() as any).requiresApproval ? "Yes" : "No" },
                    { label: "Version", value: String((wf() as any).version || 1) },
                    { label: "Last Run", value: (wf() as any).lastRunAt ? formatDate((wf() as any).lastRunAt) : "Never" },
                  ].map(item => (
                    <div class="workflow-surface rounded-lg px-3 py-2.5">
                      <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">{item.label}</p>
                      <p class="text-xs text-slate-100 mt-1 font-medium">{item.value}</p>
                    </div>
                  ))}

                  {/* Execution Endpoint */}
                  <Show when={(wf() as any).executionEndpoint}>
                    <div class="col-span-2 md:col-span-4 workflow-surface rounded-lg px-3 py-2.5">
                      <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Execution Endpoint</p>
                      <p class="text-xs text-slate-100 mt-1 font-mono break-all select-all">{(wf() as any).executionEndpoint}</p>
                    </div>
                  </Show>

                  {/* Provider Capability Note */}
                  <div class="col-span-2 md:col-span-4 rounded-lg bg-blue-500/5 border border-blue-500/20 px-4 py-3 mt-1">
                    <div class="flex items-start gap-2.5">
                      <svg class="w-4 h-4 text-blue-400 mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                      <div>
                        <p class="text-xs font-medium text-blue-400">Provider Capabilities: {providerLabels[(wf() as any).provider]}</p>
                        <p class="text-[11px] text-blue-300/80 mt-0.5">{providerNotes[(wf() as any).provider] || "Standard execution capabilities."}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Show>

            {/* Tags */}
            <Show when={workflow() && (workflow() as any).tags?.length > 0}>
              <div class={`flex flex-wrap gap-1.5 ${showEditForm() ? "hidden md:flex" : ""}`}>
                {((workflow() as any).tags || []).map((tag: string) => (
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800/70 text-slate-200 border border-slate-600/35">
                    {tag}
                  </span>
                ))}
              </div>
            </Show>

            {/* Run History */}
            <div class={showEditForm() ? "hidden md:block" : ""}>
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-sm font-semibold text-neutral-200">Run History</h2>
                <button onClick={() => refetchRuns()} class="text-[10px] text-neutral-400 hover:text-neutral-200 transition-colors">
                  ↻ Refresh
                </button>
              </div>

              <Show when={runs.loading}>
                <div class="flex items-center gap-2 text-xs text-neutral-300 py-4">
                  <div class="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Loading runs…
                </div>
              </Show>

              <Show when={!runs.loading && (runs() || []).length === 0}>
                <div class="text-center py-8 text-neutral-400 text-xs">
                  No runs yet. Trigger the workflow to see execution history.
                </div>
              </Show>

              <Show when={!runs.loading && (runs() || []).length > 0}>
                <div class="space-y-2">
                  <For each={runs() || []}>
                    {(run: any) => (
                      <div class="workflow-surface rounded-lg overflow-hidden">
                        {/* Run row */}
                        <button
                          onClick={() => loadRunDetail(run.id)}
                          class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-neutral-800/30 transition-colors"
                        >
                          <div class={`w-2 h-2 rounded-full shrink-0 ${statusDots[run.status] || "bg-neutral-500"}`} />
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <span class={`text-xs font-medium capitalize ${statusColors[run.status] || "text-neutral-400"}`}>
                                {run.status}
                              </span>
                              <span class="text-[10px] text-neutral-400 font-mono truncate">{run.id?.slice(0, 8)}</span>
                            </div>
                            <p class="text-[10px] text-neutral-400 mt-0.5">
                              {run.triggerSource} • {formatDate(run.startedAt || run.createdAt)}
                            </p>
                          </div>
                          <Show when={run.finishedAt && run.startedAt}>
                            <span class="text-[10px] text-neutral-400 shrink-0">
                              {Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
                            </span>
                          </Show>
                          <svg
                            class={`w-3 h-3 text-neutral-400 transition-transform ${expandedRun() === run.id ? "rotate-180" : ""}`}
                            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>

                        {/* Expanded detail */}
                        <Show when={expandedRun() === run.id && runDetail()}>
                          <div class="border-t border-neutral-800/50 px-4 py-3 space-y-3 block-enter">
                            {/* Normalized output */}
                            <Show when={runDetail()?.output}>
                              <div>
                                <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-400 mb-1.5">Output</p>
                                <div class="workflow-surface rounded-lg p-3">
                                  <Show when={runDetail()?.output?.summary}>
                                    <p class="text-xs text-neutral-300 mb-2">{runDetail().output.summary}</p>
                                  </Show>
                                  <pre class="text-[11px] text-neutral-300 font-mono overflow-x-auto overflow-y-auto max-h-64 whitespace-pre-wrap">
                                    {JSON.stringify(runDetail()?.output?.data || {}, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </Show>

                            {/* Error */}
                            <Show when={runDetail()?.error}>
                              <div>
                                <p class="text-[10px] uppercase tracking-[0.14em] text-red-500 mb-1.5">Error Details</p>
                                <div class="rounded-lg bg-red-500/5 border-l-2 border-red-500 p-4">
                                  <div class="flex items-start gap-3">
                                    <svg class="w-4 h-4 text-red-400 shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                    <div>
                                      <p class="text-sm font-medium text-red-400">Execution Failed</p>
                                      <p class="text-xs text-red-300 mt-1 max-w-2xl leading-relaxed">
                                        {runDetail().error?.error || runDetail().error?.message || "An unknown execution error occurred in the provider."}
                                      </p>
                                      <Show when={runDetail().error?.code || runDetail().error?.statusCode}>
                                        <div class="mt-3 flex gap-2">
                                          <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-red-500/10 text-red-300 border border-red-500/20">
                                            Code: {runDetail().error.code || runDetail().error.statusCode}
                                          </span>
                                        </div>
                                      </Show>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </Show>

                            {/* Input */}
                            <Show when={runDetail()?.input && Object.keys(runDetail()?.input || {}).length > 0}>
                              <div>
                                <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-500 mb-1.5">Input</p>
                                <div class="rounded-lg bg-neutral-900 border border-neutral-800/60 p-3">
                                  <pre class="text-[11px] text-neutral-400 font-mono overflow-x-auto overflow-y-auto max-h-64 whitespace-pre-wrap">
                                    {JSON.stringify(runDetail()?.input, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </Show>

                            {/* Raw (collapsible) */}
                            <Show when={runDetail()?._raw}>
                              <details class="group">
                                <summary class="text-[10px] text-neutral-600 cursor-pointer hover:text-neutral-400 transition-colors">
                                  Raw Provider Response ▾
                                </summary>
                                <div class="workflow-surface mt-2 rounded-lg p-3">
                                  <pre class="text-[10px] text-neutral-500 font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                                    {JSON.stringify(runDetail()._raw, null, 2)}
                                  </pre>
                                </div>
                              </details>
                            </Show>

                            {/* Timestamp Timeline */}
                            <div class="pt-4 border-t border-neutral-800/50">
                              <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-500 mb-3">Execution Timeline</p>
                              <div class="relative pl-3 space-y-4 before:absolute before:inset-y-1 before:left-[5px] before:w-[2px] before:bg-neutral-800">
                                <div class="relative flex items-center gap-3 text-xs">
                                  <div class="absolute -left-3 w-2.5 h-2.5 rounded-full bg-neutral-600 border-2 border-[#0d0d0d]" />
                                  <span class="text-neutral-300 font-medium w-20">Queued:</span>
                                  <span class="text-neutral-500 font-mono">{formatDate(runDetail()?.timing?.startedAt || run.createdAt)}</span>
                                </div>

                                <Show when={runDetail()?.timing?.startedAt || run.status === "running"}>
                                  <div class="relative flex items-center gap-3 text-xs">
                                    <div class={`absolute -left-3 w-2.5 h-2.5 rounded-full border-2 border-[#0d0d0d] ${run.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-blue-500'}`} />
                                    <span class="text-blue-400 font-medium w-20">Started:</span>
                                    <span class="text-neutral-500 font-mono">{formatDate(runDetail()?.timing?.startedAt || run.createdAt)}</span>
                                  </div>
                                </Show>

                                <Show when={runDetail()?.timing?.finishedAt || run.status === "completed" || run.status === "failed"}>
                                  <div class="relative flex items-center gap-3 text-xs">
                                    <div class={`absolute -left-3 w-2.5 h-2.5 rounded-full border-2 border-[#0d0d0d] ${run.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                    <span class={`font-medium w-20 ${run.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {run.status === 'completed' ? 'Completed:' : 'Failed:'}
                                    </span>
                                    <span class="text-neutral-500 font-mono flex items-center gap-2">
                                      {formatDate(runDetail()?.timing?.finishedAt)}
                                      <Show when={runDetail()?.timing?.durationMs !== null}>
                                        <span class="px-1.5 rounded-full bg-neutral-800 text-[10px] text-neutral-400">
                                          {(runDetail()?.timing?.durationMs / 1000).toFixed(2)}s
                                        </span>
                                      </Show>
                                    </span>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

          </div>
        </div>
      </main>
    </>
  );
}
