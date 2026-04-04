import { Title } from "@solidjs/meta";
import { createResource, createSignal, createEffect, createMemo, For, Show, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { ChatAttachmentDto } from "@autopilot/shared";
import { MessageBubble } from "../components/chat/MessageBubble";
import { DetailPanel } from "../components/chat/DetailPanel";
import { usePanel } from "../context/panel.context";
import { useMobileMenu } from "../context/mobile-menu.context";
import { approvalsApi, chatApi, settingsApi, workflowsApi } from "../lib/api";
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import type { ActionItem, AssistantBlock, MessageState, TaskCardBlock, WorkflowStatus, WorkflowStatusBlock } from "../components/chat/types";
import {
  coerceWorkflowStatus,
  fallbackAssistantBlocks,
  humanizeStatus,
  humanizeWorkflowKey,
  normalizeProviderName,
  prettyProviderName,
} from "./chat.helpers";

/**
  * chat page props type alias.
  */
type ChatPageProps = { threadId?: string };
/**
 * Handles chat page.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Value passed to ChatPage.
 * @returns The value returned by ChatPage.
 *
 * @example
 * ```typescript
 * const output = ChatPage(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function ChatPage(props: ChatPageProps = {}) {
  const { openPanel } = usePanel();
  const mobileMenu = useMobileMenu();
  const [threads, { refetch: refetchThreads }] = createResource(() => chatApi.getThreads());
  const [providers] = createResource(() => settingsApi.getProviders());
  const [allWorkflows] = createResource(() => workflowsApi.getAll({ archived: "false" }));


  // Aggregate all models from all endpoints
  const [aggregatedModels] = createResource(providers, async (provs) => {
    if (!provs) return [];

    // Fallback: If no providers configured, try fetching local Ollama
    let targetProvs = provs;
    if (provs.length === 0) {
      targetProvs = [{
        id: 'default-local',
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        isDefault: true
      }];
    }
    const results = await Promise.all(
      targetProvs.map(async (p: any) => {
        try {
          const models = await settingsApi.fetchModels({
            provider: p.provider,
            providerId: p.id,
            baseUrl: p.baseUrl,
            apiKey: p.apiKey
          });
          return models.map((m: string) => ({
            providerId: p.id,
            providerName: normalizeProviderName(p.provider),
            modelName: m
          }));
        } catch (e) {
          console.error(`Failed to fetch models for ${p.provider}`, e);
          return [];
        }
      })
    );
    return results.flat();
  });

  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(props.threadId ?? null);
  const [loadedThreadId, setLoadedThreadId] = createSignal<string | null>(null);
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [lastDraftKey, setLastDraftKey] = createSignal<string | null>(null);
  const [lastAutoSendKey, setLastAutoSendKey] = createSignal<string | null>(null);
  const [messages, setMessages] = createSignal<any[]>([]);
  const [input, setInput] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [selectedModelStr, setSelectedModelStr] = createSignal(""); // "providerId:::modelName"
  const AUTO_MODEL_SELECTION = "auto:::auto";

  // In-flight streaming message — isolated from historical messages list for efficient chunk updates
  const [streamMsg, setStreamMsg] = createStore<{
    active: boolean;
    id: string;
    state: MessageState;
    blocks: AssistantBlock[];
    streamingBlockIdx: number;
    createdAt: string;
  }>({ active: false, id: "", state: "thinking", blocks: [], streamingBlockIdx: -1, createdAt: "" });

  // Thread management state
  const [editingThreadId, setEditingThreadId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [menuOpenId, setMenuOpenId] = createSignal<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = createSignal(false);
  const [modelProviderTab, setModelProviderTab] = createSignal<string>("all");
  const [showModelSearch, setShowModelSearch] = createSignal(false);
  const [modelSearchQuery, setModelSearchQuery] = createSignal("");
  const [isBurning, setIsBurning] = createSignal(false);
  const [showScrollToBottom, setShowScrollToBottom] = createSignal(false);
  const [confirmModal, setConfirmModal] = createSignal<{ type: "delete" | "clear-all"; threadId?: string } | null>(null);
  const [isCustomizePanelOpen, setIsCustomizePanelOpen] = createSignal(false);
  const [chatFontScale, setChatFontScale] = createSignal<number>(100);
  const [highlightedSlashIdx, setHighlightedSlashIdx] = createSignal(0);
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = createSignal(false);
  const [composerError, setComposerError] = createSignal("");
  const composerHints = ["Add task...", "Run workflow...", "Check emails..."];
  const [placeholderHintIndex, setPlaceholderHintIndex] = createSignal(0);
  let feedRef: HTMLDivElement | undefined;
  let attachmentInputRef: HTMLInputElement | undefined;
  let composerTextareaRef: HTMLTextAreaElement | undefined;

  /**
   * Handles reset composer height.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns The value returned by resetComposerHeight.
   *
   * @example
   * ```typescript
   * const output = resetComposerHeight();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function resetComposerHeight() {
    if (!composerTextareaRef) return;
    composerTextareaRef.style.height = "auto";
  }

  /**
   * Handles emit client telemetry.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns The value returned by emitClientTelemetry.
   *
   * @example
   * ```typescript
   * const output = emitClientTelemetry();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function emitClientTelemetry(payload: {
    level: "info" | "warn" | "error";
    category: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await chatApi.sendClientTelemetry(payload);
    } catch {
      // Never block UX on telemetry failures.
    }
  }

  createEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderHintIndex((prev) => (prev + 1) % composerHints.length);
    }, 2600);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("chat_font_scale");
    const parsed = saved ? Number(saved) : NaN;
    if (Number.isFinite(parsed)) {
      const safe = Math.min(130, Math.max(85, Math.round(parsed)));
      setChatFontScale(safe);
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("chat_font_scale", String(chatFontScale()));
  });

  // Scroll feed whenever a new block arrives during streaming
  createEffect(() => {
    if (streamMsg.active) {
      // Track block count — scroll on each new block (not on every chunk)
      void streamMsg.blocks.length;
      void streamMsg.state;
      scrollFeed();
    }
  });

  createEffect(() => {
    void messages().length;
    void streamMsg.active;
    setTimeout(() => updateScrollToBottomVisibility(), 0);
  });
  const getAssistantBlocks = (msg: any): AssistantBlock[] => {
    const raw = msg?.blocks;
    const rawList = Array.isArray(raw) ? raw : Array.isArray(raw?.blocks) ? raw.blocks : [];

    if (!rawList.length) return fallbackAssistantBlocks(msg?.content);
    const mapped: AssistantBlock[] = rawList.flatMap((block: any): AssistantBlock[] => {
      // ── Legacy block: expand into proper structured block set ──────────────
      if (block?.type === "workflow_card") {
        const workflowName = humanizeWorkflowKey(block.workflowKey || block.name);
        const status = coerceWorkflowStatus(block.status);
        return [
          { type: "summary", items: [`${workflowName} is ${humanizeStatus(status)}.`] },
          {
            type: "workflow_status",
            workflow: {
              name: workflowName,
              status,
              runId: block.runId || "run-pending",
              startedAt: block.startedAt,
              completedAt: block.completedAt,
              timeline: status === "running" ? "Execution in progress" : undefined,
              details: {
                workflow_key: String(block.workflowKey || "unknown"),
                run_id: String(block.runId || "run-pending"),
              },
            },
          },
          {
            type: "source",
            origin: "n8n Workflow Engine",
            metadata: [block.workflowKey ? `Workflow: ${block.workflowKey}` : "Workflow dispatch"],
          },
          {
            type: "actions",
            items: [
              { id: "open-workflow", label: "Open Details", variant: "primary" },
              { id: "mark-complete", label: "Mark Complete", variant: "secondary" },
              { id: "edit-workflow", label: "Edit", variant: "ghost" },
            ],
          },
        ];
      }

      // ── task_card: normalize flat-shape vs. nested-shape ─────────────────
      if (block?.type === "task_card") {
        return [{
          type: "task_card",
          task: {
            title: block.title || block.task?.title || "Suggested task",
            status: block.status || block.task?.status || "Pending",
            source: block.source || block.task?.source || "Assistant",
            dueDate: block.dueDate || block.task?.dueDate,
            description: block.description || block.task?.description,
            details: block.details || block.task?.details,
          },
        }];
      }

      // ── All other known block types: pass through directly ───────────────
      const knownTypes = new Set([
        "workflow_status", "summary", "actions", "source", "result",
        "markdown", "text", "thinking", "email_draft", "error", "timeline",
        "detail_toggle", "approval_card", "question_mcq",
      ]);
      if (block?.type && knownTypes.has(block.type)) {
        return [block as AssistantBlock];
      }

      return [];
    });
    const hasQuestion = mapped.some((b: AssistantBlock) => b.type === "question_mcq");
    if (!hasQuestion) {
      const sourceWithQuestionMeta = mapped.find(
        (b: AssistantBlock) =>
          b.type === "source" &&
          ((b as { metadata?: string[] }).metadata || []).some((m: string) =>
            String(m).includes("answerMode: interactive_question"),
          ),
      );
      if (sourceWithQuestionMeta) {
        const prompt = (() => {
          const content = String(msg?.content || "").trim();
          if (!content) return "Choose how you want to continue.";
          const firstLine = content.split("\n").map((l: string) => l.trim()).find((l: string) => l.length > 0);
          return firstLine || "Choose how you want to continue.";
        })();
        mapped.unshift({
          type: "question_mcq",
          questionId: `legacy_${msg?.id || Date.now()}`,
          prompt,
          state: "expired",
          stale: true,
          allowFreeText: false,
          options: [
            { id: "use_old", label: "Use old result", valueToSend: "use old", description: "Answer from existing result." },
            { id: "rerun_now", label: "Rerun now", valueToSend: "rerun now", description: "Trigger a fresh workflow run." },
          ],
        });
      }
    }

    return mapped.length ? mapped : fallbackAssistantBlocks(msg?.content);
  };
  const openTaskDetails = (block: TaskCardBlock) => {
    openPanel({
      title: block.task.title,
      content: (
        <DetailPanel
          title={block.task.title}
          description={block.task.description}
          metadata={{
            status: block.task.status,
            source: block.task.source,
            due_date: block.task.dueDate || "Not set",
            ...(block.task.details || {}),
          }}
        />
      ),
    });
  };
  const openWorkflowDetails = async (block: WorkflowStatusBlock) => {
    // Fetch fresh run data from the API for accurate details
    const runId = block.workflow.runId;
    if (runId) {
      try {
        const run = await workflowsApi.getRunById(runId, true);
        const isCompleted = run.status === "completed";
        const isFailed = run.status === "failed";
        const duration = run.timing?.durationMs != null
          ? run.timing.durationMs < 1000 ? `${run.timing.durationMs}ms` : `${(run.timing.durationMs / 1000).toFixed(1)}s`
          : null;

        openPanel({
          title: `${block.workflow.name} run`,
          content: (
            <div class="space-y-5">
              {/* Header */}
              <div>
                <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Workflow Run</p>
                <h3 class="mt-2 text-base font-semibold text-neutral-100">{block.workflow.name}</h3>
                <div class="mt-2 flex items-center gap-2">
                  <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isCompleted ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : isFailed ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20"}`}>
                    {run.status}
                  </span>
                  <Show when={duration}><span class="text-xs text-neutral-500">{duration}</span></Show>
                </div>
              </div>

              {/* Run Info */}
              <div class="space-y-2">
                <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Details</p>
                <div class="rounded-xl border border-neutral-800/70 divide-y divide-neutral-800/70 bg-neutral-900/60">
                  {[
                    ["Run ID", run.id],
                    ["Workflow", run.workflowKey],
                    ["Provider", run.provider],
                    ["Trigger", run.triggerSource],
                    ["Started", run.timing?.startedAt ? new Date(run.timing.startedAt).toLocaleString() : "—"],
                    ["Finished", run.timing?.finishedAt ? new Date(run.timing.finishedAt).toLocaleString() : "—"],
                  ].map(([k, v]) => (
                    <div class="px-3 py-2.5 flex items-start justify-between gap-4">
                      <span class="text-xs text-neutral-500">{k}</span>
                      <span class="text-xs text-neutral-200 text-right break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Output / Response */}
              <Show when={isCompleted && run.output}>
                <div class="space-y-2">
                  <p class="text-[10px] uppercase tracking-[0.16em] text-emerald-400 font-semibold">Response Data</p>
                  <pre class="text-xs text-neutral-200 bg-neutral-900/80 border border-emerald-500/20 rounded-xl p-3 overflow-x-auto max-h-80 whitespace-pre-wrap break-all">
                    {JSON.stringify(run.output, null, 2)}
                  </pre>
                </div>
              </Show>

              {/* Raw Provider Response */}
              <Show when={run._raw}>
                <div class="space-y-2">
                  <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Raw Provider Response</p>
                  <pre class="text-xs text-neutral-400 bg-neutral-900/80 border border-neutral-800/70 rounded-xl p-3 overflow-x-auto max-h-60 whitespace-pre-wrap break-all">
                    {JSON.stringify(run._raw, null, 2)}
                  </pre>
                </div>
              </Show>

              {/* Error */}
              <Show when={isFailed && run.error}>
                <div class="space-y-2">
                  <p class="text-[10px] uppercase tracking-[0.16em] text-red-400 font-semibold">Error</p>
                  <pre class="text-xs text-red-300 bg-red-500/5 border border-red-500/20 rounded-xl p-3 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                    {JSON.stringify(run.error, null, 2)}
                  </pre>
                </div>
              </Show>
            </div>
          ),
        });
        return;
      } catch {
        // Fall through to static block data
      }
    }

    // Fallback: use block data if API fetch fails
    openPanel({
      title: `${block.workflow.name} run`,
      content: (
        <DetailPanel
          title={block.workflow.name}
          description={block.workflow.timeline}
          metadata={{
            status: block.workflow.status,
            run_id: block.workflow.runId,
            started_at: block.workflow.startedAt || "Unknown",
            completed_at: block.workflow.completedAt || "Not completed",
            ...(block.workflow.details || {}),
          }}
        />
      ),
    });
  };
  const handleAction = async (action: ActionItem) => {
    if (action.id.startsWith("approve:") || action.id.startsWith("reject:")) {
      const approvalId = action.id.split(":")[1] || action.entityId;
      if (approvalId) {
        try {
          const status = action.id.startsWith("approve:") ? "approved" : "rejected";
          await approvalsApi.resolve(approvalId, status);
        } catch (err) {
          console.error("Failed to resolve approval action:", err);
        }
      }
      return;
    }
    if (action.id === "view-run" && action.entityId) {
      try {
        const run = await workflowsApi.getRunById(action.entityId, true);
        const isCompleted = run.status === "completed";
        const isFailed = run.status === "failed";
        const duration = run.timing?.durationMs != null
          ? run.timing.durationMs < 1000 ? `${run.timing.durationMs}ms` : `${(run.timing.durationMs / 1000).toFixed(1)}s`
          : null;

        openPanel({
          title: `Run ${run.id?.slice(0, 8)}…`,
          content: (
            <div class="space-y-5">
              {/* Header */}
              <div>
                <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Workflow Run</p>
                <h3 class="mt-2 text-base font-semibold text-neutral-100">{run.workflowKey || "Unknown Workflow"}</h3>
                <div class="mt-2 flex items-center gap-2">
                  <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isCompleted ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : isFailed ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20"}`}>
                    {run.status}
                  </span>
                  <Show when={duration}><span class="text-xs text-neutral-500">{duration}</span></Show>
                </div>
              </div>

              {/* Run Info */}
              <div class="space-y-2">
                <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Details</p>
                <div class="rounded-xl border border-neutral-800/70 divide-y divide-neutral-800/70 bg-neutral-900/60">
                  {[
                    ["Run ID", run.id],
                    ["Provider", run.provider],
                    ["Trigger", run.triggerSource],
                    ["Started", run.timing?.startedAt ? new Date(run.timing.startedAt).toLocaleString() : "—"],
                    ["Finished", run.timing?.finishedAt ? new Date(run.timing.finishedAt).toLocaleString() : "—"],
                  ].map(([k, v]) => (
                    <div class="px-3 py-2.5 flex items-start justify-between gap-4">
                      <span class="text-xs text-neutral-500">{k}</span>
                      <span class="text-xs text-neutral-200 text-right break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Input */}
              <Show when={run.input && Object.keys(run.input).length > 0}>
                <div class="space-y-2">
                  <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Input</p>
                  <pre class="text-xs text-neutral-300 bg-neutral-900/80 border border-neutral-800/70 rounded-xl p-3 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                    {JSON.stringify(run.input, null, 2)}
                  </pre>
                </div>
              </Show>

              {/* Output / Response */}
              <Show when={isCompleted && run.output}>
                <div class="space-y-2">
                  <p class="text-[10px] uppercase tracking-[0.16em] text-emerald-400 font-semibold">Response Data</p>
                  <pre class="text-xs text-neutral-200 bg-neutral-900/80 border border-emerald-500/20 rounded-xl p-3 overflow-x-auto max-h-80 whitespace-pre-wrap break-all">
                    {JSON.stringify(run.output, null, 2)}
                  </pre>
                </div>
              </Show>

              {/* Raw Provider Response */}
              <Show when={run._raw}>
                <div class="space-y-2">
                  <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Raw Provider Response</p>
                  <pre class="text-xs text-neutral-400 bg-neutral-900/80 border border-neutral-800/70 rounded-xl p-3 overflow-x-auto max-h-60 whitespace-pre-wrap break-all">
                    {JSON.stringify(run._raw, null, 2)}
                  </pre>
                </div>
              </Show>

              {/* Error */}
              <Show when={isFailed && run.error}>
                <div class="space-y-2">
                  <p class="text-[10px] uppercase tracking-[0.16em] text-red-400 font-semibold">Error</p>
                  <pre class="text-xs text-red-300 bg-red-500/5 border border-red-500/20 rounded-xl p-3 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                    {JSON.stringify(run.error, null, 2)}
                  </pre>
                </div>
              </Show>
            </div>
          ),
        });
      } catch {
        openPanel({
          title: "Run Details",
          content: <DetailPanel title="Error" description="Could not load run details." />,
        });
      }
    } else if (action.id === "retry-workflow" && action.entityId) {
      // Retry by re-triggering the workflow through the chat
      try {
        const workflow = await workflowsApi.getById(action.entityId);
        const key = workflow?.key || workflow?.workflowKey;
        if (key) {
          sendMessage(`Run workflow: ${key}`);
        } else {
          await workflowsApi.trigger(action.entityId, { source: "ui", input: {} });
        }
      } catch (e: any) {
        console.error("Retry failed:", e);
      }
    } else if (action.id === "open-workflow") {
      openPanel({
        title: "Workflow details",
        content: <DetailPanel title="Workflow action" description="Use this panel to inspect and manage the current automation run." />,
      });
    } else if (action.id === "send-email-draft") {
      const subject = String(action.data?.subject || "").trim();
      const body = String(action.data?.body || "").trim();
      if (!subject || !body) return;
      const workflows = (allWorkflows() || []) as any[];
      const candidate = workflows
        .filter((wf) => wf && wf.enabled !== false && wf.archived !== true)
        .map((wf) => {
          const haystack = [
            String(wf.key || ""),
            String(wf.name || ""),
            String(wf.description || ""),
            ...(Array.isArray(wf.tags) ? wf.tags.map((tag: unknown) => String(tag || "")) : []),
          ].join(" ").toLowerCase();
          let score = 0;
          if (/\b(email|mail|gmail)\b/.test(haystack)) score += 8;
          if (/\b(send|smtp|deliver|compose|draft)\b/.test(haystack)) score += 6;
          if (String(wf.key || "").toLowerCase().includes("scan")) score -= 6;
          if (String(wf.key || "").toLowerCase().includes("summary")) score -= 3;
          return { wf, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.wf;
      const command = candidate?.key
        ? `Run workflow: ${candidate.key}\n\nSend this email draft.\nSubject: ${subject}\n\n${body}`
        : `Send this email using the appropriate email workflow.\n\nSubject: ${subject}\n\n${body}`;

      await sendMessage(command);
    }
  };
  const handleQuestionAnswer = async (payload: { messageId?: string; questionId: string; optionId?: string; valueToSend: string }) => {
    const value = (payload.valueToSend || "").trim();
    const messageId = (payload.messageId || "").trim();
    if (!value || !messageId) return;
    const threadId = activeThreadId();
    if (!threadId) return;
    let selectedProviderId: string | undefined;
    let selectedModelName: string | undefined;
    if (selectedModelStr()) {
      const parts = selectedModelStr().split(":::");
      selectedProviderId = parts[0];
      selectedModelName = parts[1];
    }

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || m.role !== "assistant") return m;
        const normalized = getAssistantBlocks(m).map((b) => {
          if (b.type !== "question_mcq" || b.questionId !== payload.questionId) return b;
          return {
            ...b,
            state: "submitting",
            selectedOptionId: payload.optionId || b.selectedOptionId || null,
            selectedValue: value,
          };
        });
        return { ...m, blocks: { blocks: normalized } };
      }),
    );

    try {
      const result = await chatApi.answerQuestionInline(threadId, messageId, payload.questionId, {
        optionId: payload.optionId,
        valueToSend: value,
        providerId: selectedProviderId,
        model: selectedModelName,
      });
      const updatedMessage = result?.message;
      if (!updatedMessage?.id) return;
      setMessages((prev) => prev.map((m) => (m.id === updatedMessage.id ? { ...m, ...updatedMessage } : m)));
      await refetchThreads();
    } catch (e: any) {
      const errorText = e?.message || "Failed to submit answer.";
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || m.role !== "assistant") return m;
          const normalized = getAssistantBlocks(m).map((b) => {
            if (b.type !== "question_mcq" || b.questionId !== payload.questionId) return b;
            return {
              ...b,
              state: "pending",
              selectedOptionId: null,
              selectedValue: null,
              continuation: [
                ...(Array.isArray(b.continuation) ? b.continuation : []),
                { type: "error", title: "Question submit failed", message: errorText },
              ],
            };
          });
          return { ...m, blocks: { blocks: normalized } };
        }),
      );
    }
  };

  // Auto-select a model when aggregated models/settings load
  createEffect(() => {
    const models = aggregatedModels();
    if (selectedModelStr()) return;
    const defaultProv = providers()?.find((p: any) => p.isDefault);
    const configuredModel = (defaultProv?.model || "").trim();
    if (configuredModel.toLowerCase() === "auto") {
      setSelectedModelStr(AUTO_MODEL_SELECTION);
      return;
    }
    if (!models || models.length === 0) return;
    const exactConfiguredModel =
      configuredModel && configuredModel !== "dynamic"
        ? models.find((m) => m.providerId === defaultProv?.id && m.modelName === configuredModel)
        : null;
    const defaultModel = exactConfiguredModel || models.find(m => m.providerId === defaultProv?.id);
    if (defaultModel) {
      setSelectedModelStr(`${defaultModel.providerId}:::${defaultModel.modelName}`);
    } else {
      setSelectedModelStr(`${models[0].providerId}:::${models[0].modelName}`);
    }
  });

  // Load messages when thread is selected
  /**
   * Handles select thread.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param threadId - Value passed to selectThread.
   * @returns The value returned by selectThread.
   *
   * @example
   * ```typescript
   * const output = selectThread(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function selectThread(threadId: string) {
    setActiveThreadId(threadId);
    // Update URL to /threads/:id if not already there
    if (params.id !== threadId) {
      navigate(`/threads/${threadId}`, { replace: false });
    }
    try {
      const msgs = await chatApi.getMessages(threadId);
      setMessages(msgs);
      setLoadedThreadId(threadId);
      setPendingFiles([]);
      setComposerError("");
      scrollFeed();
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/thread not found/i.test(msg)) {
        setActiveThreadId(null);
        setLoadedThreadId(null);
        setMessages([]);
        setPendingFiles([]);
        setComposerError("This thread is no longer available. Started from a new thread.");
        navigate("/", { replace: false });
        return;
      }
      console.error("Failed to load thread messages", e);
      setLoadedThreadId(null);
      setComposerError("Failed to load this thread.");
    }
  }

  // Create a new thread explicitly
  /**
   * Handles new thread.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns The value returned by newThread.
   *
   * @example
   * ```typescript
   * const output = newThread();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function newThread() {
    setActiveThreadId(null);
    setLoadedThreadId(null);
    setMessages([]);
    setInput("");
    resetComposerHeight();
    setPendingFiles([]);
    setComposerError("");
    // Go back to main chat page
    navigate("/", { replace: false });
  }
  // On mount/refresh, hydrate the thread from the URL even if activeThreadId
  // was pre-seeded from props. Without this, refresh can stay on the empty state.
  createEffect(() => {
    if (props.threadId && loadedThreadId() !== props.threadId) {
      selectThread(props.threadId);
    } else if (!props.threadId && activeThreadId()) {
      setLoadedThreadId(null);
    }
  });

  createEffect(() => {
    const draft = typeof searchParams.draft === "string" ? searchParams.draft : "";
    const autoSend = searchParams.autosend === "1";
    if (!draft.trim()) return;
    const draftKey = `${params.id || "root"}::${draft}`;
    if (lastDraftKey() === draftKey) return;

    setInput(draft);
    setLastDraftKey(draftKey);

    if (autoSend) {
      const autoSendKey = `${draftKey}::autosend`;
      if (lastAutoSendKey() !== autoSendKey) {
        setLastAutoSendKey(autoSendKey);
        // Let the route/thread mount settle before starting the stream send.
        window.setTimeout(() => {
          sendMessage(draft);
        }, 20);
      }
    }

    setSearchParams({ draft: undefined, autosend: undefined }, { replace: true });
  });

  // Send a message — uses SSE streaming for progressive assistant rendering
  /**
   * Handles send message.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param overrideText - Value passed to sendMessage.
   * @returns The value returned by sendMessage.
   *
   * @example
   * ```typescript
   * const output = sendMessage(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function sendMessage(overrideText?: string) {
    const text = (overrideText || input()).trim();
    const queuedFiles = pendingFiles();
    if ((!text && queuedFiles.length === 0) || sending()) return;

    setSending(true);
    setInput("");
    resetComposerHeight();
    setComposerError("");
    let selectedProviderId: string | undefined;
    let selectedModelName: string | undefined;
    if (selectedModelStr()) {
      const parts = selectedModelStr().split(":::");
      selectedProviderId = parts[0];
      selectedModelName = parts[1];
    }
    let targetThreadId = activeThreadId();
    if (!targetThreadId) {
      const titleFromText = text || queuedFiles.map((f) => f.name).join(", ");
      const threadTitle = titleFromText.replace(/\n/g, " ").slice(0, 40).trim();
      const thread = await chatApi.createThread(threadTitle || "New Thread");
      await refetchThreads();
      setActiveThreadId(thread.id);
      targetThreadId = thread.id;
    }
    let uploadedAttachments: ChatAttachmentDto[] = [];
    if (queuedFiles.length > 0) {
      try {
        setUploadingAttachments(true);
        uploadedAttachments = await chatApi.uploadAttachments(
          targetThreadId!,
          queuedFiles,
          selectedProviderId,
          selectedModelName,
        );
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (/thread not found/i.test(msg)) {
          const titleFromText = text || queuedFiles.map((f) => f.name).join(", ");
          const threadTitle = titleFromText.replace(/\n/g, " ").slice(0, 40).trim();
          const newThread = await chatApi.createThread(threadTitle || "New Thread");
          await refetchThreads();
          setActiveThreadId(newThread.id);
          targetThreadId = newThread.id;
          setComposerError("Previous thread was unavailable. Continued in a new thread.");
          try {
            uploadedAttachments = await chatApi.uploadAttachments(
              targetThreadId,
              queuedFiles,
              selectedProviderId,
              selectedModelName,
            );
          } catch (uploadRetryErr: any) {
            setComposerError(uploadRetryErr?.message || "Failed to upload attachments.");
            setSending(false);
            setUploadingAttachments(false);
            return;
          }
        } else {
          setComposerError(e?.message || "Failed to upload attachments.");
          setSending(false);
          setUploadingAttachments(false);
          return;
        }
      } finally {
        setUploadingAttachments(false);
      }
    }

    // Optimistic user message (replaced with real one on user_saved event)
    const optimisticId = `tmp_${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: optimisticId,
      role: "user",
      content: text || "",
      attachments: uploadedAttachments,
      createdAt: new Date().toISOString(),
    }]);
    setPendingFiles([]);
    if (attachmentInputRef) attachmentInputRef.value = "";

    // Prime in-flight assistant message
    setStreamMsg({ active: true, id: `inflight_${Date.now()}`, state: "thinking", blocks: [], streamingBlockIdx: -1, createdAt: new Date().toISOString() });
    scrollFeed();
    let recoveredFromMissingThread = false;
    let recoveredFromStreamDrop = false;
    let userPersisted = false;
    try {
      while (true) {
        try {
          for await (const { event, data } of chatApi.sendMessageStream(
            targetThreadId!,
            text,
            selectedProviderId,
            selectedModelName,
            uploadedAttachments.map((a) => a.id),
          )) {
            switch (event) {
              case "user_saved":
                userPersisted = true;
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== optimisticId) return m;
                    const saved = data?.message;
                    if (!saved || typeof saved !== "object") return m;
                    const savedContent =
                      typeof (saved as { content?: unknown }).content === "string" &&
                        ((saved as { content: string }).content || "").trim().length > 0
                        ? (saved as { content: string }).content
                        : m.content;
                    return {
                      ...m,
                      ...(saved as Record<string, unknown>),
                      id: typeof (saved as { id?: unknown }).id === "string" ? (saved as { id: string }).id : m.id,
                      role: "user",
                      content: savedContent,
                      attachments: m.attachments,
                      createdAt:
                        typeof (saved as { createdAt?: unknown }).createdAt === "string"
                          ? (saved as { createdAt: string }).createdAt
                          : m.createdAt,
                    };
                  }),
                );
                break;

              case "thinking":
                setStreamMsg("state", "thinking");
                break;

              case "block": {
                setStreamMsg("blocks", produce((blocks) => { blocks[data.index] = data.block; }));
                setStreamMsg("state", "streaming");
                setStreamMsg("streamingBlockIdx", data.index);
                break;
              }

              case "chunk": {
                setStreamMsg("blocks", produce((blocks) => {
                  const b = blocks[data.blockIndex] as any;
                  if (b) b.text = (b.text ?? "") + data.content;
                }));
                setStreamMsg("streamingBlockIdx", data.blockIndex);
                break;
              }

              case "block_end":
                setStreamMsg("streamingBlockIdx", -1);
                break;

              case "complete": {
                // Snapshot completed blocks for history (plain JS objects, not reactive proxies)
                const finalBlocks = streamMsg.blocks.map((b) => ({ ...b }));
                setMessages((prev) => [
                  ...prev,
                  { id: data.messageId, role: "assistant", blocks: { blocks: finalBlocks }, content: null, createdAt: data.createdAt },
                ]);
                setStreamMsg({ active: false, id: "", state: "thinking", blocks: [], streamingBlockIdx: -1, createdAt: "" });
                break;
              }

              case "error":
                setStreamMsg("state", "error");
                setStreamMsg("blocks", [{ type: "error", message: data.message ?? "Something went wrong." }] as AssistantBlock[]);
                setStreamMsg("streamingBlockIdx", -1);
                break;
            }
          }
          break;
        } catch (err: any) {
          const msg = String(err?.message || "");
          if (!recoveredFromMissingThread && /thread not found/i.test(msg)) {
            recoveredFromMissingThread = true;
            const titleFromText = text || queuedFiles.map((f) => f.name).join(", ");
            const threadTitle = titleFromText.replace(/\n/g, " ").slice(0, 40).trim();
            const newThread = await chatApi.createThread(threadTitle || "New Thread");
            await refetchThreads();
            setActiveThreadId(newThread.id);
            targetThreadId = newThread.id;
            setComposerError("Previous thread was unavailable. Continued in a new thread.");
            if (queuedFiles.length > 0) {
              uploadedAttachments = await chatApi.uploadAttachments(
                targetThreadId,
                queuedFiles,
                selectedProviderId,
                selectedModelName,
              );
              setMessages((prev) =>
                prev.map((m) => (m.id === optimisticId ? { ...m, attachments: uploadedAttachments } : m)),
              );
            }
            continue;
          }
          const isLikelyTransientStreamError =
            /failed to fetch|network|stream|timeout|socket|aborted|http 5\d\d/i.test(msg);
          if (!recoveredFromStreamDrop && !userPersisted && isLikelyTransientStreamError) {
            recoveredFromStreamDrop = true;
            setComposerError("Connection interrupted. Retrying once automatically…");
            await emitClientTelemetry({
              level: "warn",
              category: "chat_stream_retry",
              message: "Transient stream interruption recovered with retry",
              metadata: { threadId: targetThreadId, reason: msg.slice(0, 160) },
            });
            continue;
          }
          await emitClientTelemetry({
            level: "error",
            category: "chat_stream_failed",
            message: "Streaming request failed",
            metadata: { threadId: targetThreadId, reason: msg.slice(0, 240), retried: recoveredFromStreamDrop },
          });
          throw err;
        }
      }
    } catch (e: any) {
      setStreamMsg("state", "error");
      setStreamMsg("blocks", [{ type: "error", message: e?.message ?? "Failed to send message." }] as AssistantBlock[]);
      setStreamMsg("streamingBlockIdx", -1);
    } finally {
      setSending(false);
      scrollFeed();
    }
  }

  /**
   * Handles on select files.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param ev - Value passed to onSelectFiles.
   * @returns The value returned by onSelectFiles.
   *
   * @example
   * ```typescript
   * const output = onSelectFiles(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function onSelectFiles(ev: Event) {
    const inputEl = ev.currentTarget as HTMLInputElement;
    const files = Array.from(inputEl.files || []);
    if (!files.length) return;
    const existing = pendingFiles();
    const dedup = new Map<string, File>();
    [...existing, ...files].forEach((f) => dedup.set(`${f.name}:${f.size}:${f.type}`, f));
    setPendingFiles(Array.from(dedup.values()).slice(0, 6));
  }

  /**
   * Handles update scroll to bottom visibility.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns The value returned by updateScrollToBottomVisibility.
   *
   * @example
   * ```typescript
   * const output = updateScrollToBottomVisibility();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function updateScrollToBottomVisibility() {
    const feed = feedRef;
    if (!feed) {
      setShowScrollToBottom(false);
      return;
    }
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 160);
  }

  /**
   * Handles scroll feed.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param behavior - Value passed to scrollFeed.
   * @returns The value returned by scrollFeed.
   *
   * @example
   * ```typescript
   * const output = scrollFeed(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function scrollFeed(behavior: ScrollBehavior = "smooth") {
    setTimeout(() => {
      feedRef?.scrollTo({ top: feedRef.scrollHeight, behavior });
      setTimeout(() => updateScrollToBottomVisibility(), 70);
    }, 50);
  }

  /**
   * Handles commit rename.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param threadId - Value passed to commitRename.
   * @returns The value returned by commitRename.
   *
   * @example
   * ```typescript
   * const output = commitRename(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function commitRename(threadId: string) {
    const title = renameValue().trim();
    setEditingThreadId(null);
    if (!title || title.length > 50) return;
    try {
      await chatApi.renameThread(threadId, title);
      await refetchThreads();
    } catch (e) {
      console.error("Failed to rename thread", e);
    }
  }

  /**
   * Handles confirm delete.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param threadId - Value passed to confirmDelete.
   * @returns The value returned by confirmDelete.
   *
   * @example
   * ```typescript
   * const output = confirmDelete(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function confirmDelete(threadId: string) {
    setConfirmModal(null);
    if (activeThreadId() === threadId) {
      setActiveThreadId(null);
      setMessages([]);
    }
    try {
      await chatApi.deleteThread(threadId);
      await refetchThreads();
    } catch (e) {
      console.error("Failed to delete thread", e);
    }
  }

  /**
   * Handles clear all threads.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns The value returned by clearAllThreads.
   *
   * @example
   * ```typescript
   * const output = clearAllThreads();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function clearAllThreads() {
    setConfirmModal(null);
    setIsBurning(true);
    try {
      await chatApi.deleteAllThreads();
      setActiveThreadId(null);
      setMessages([]);
      // Let burn animation play then refresh
      setTimeout(async () => {
        await refetchThreads();
        setIsBurning(false);
      }, 800);
    } catch (e) {
      console.error("Failed to clear all threads", e);
      setIsBurning(false);
    }
  }

  /**
   * Handles handle key.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param e - Value passed to handleKey.
   * @returns The value returned by handleKey.
   *
   * @example
   * ```typescript
   * const output = handleKey(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function handleKey(e: KeyboardEvent) {
    if (showSlashMenu()) {
      const options = slashWorkflowOptions();
      if (e.key === "ArrowDown" && options.length > 0) {
        e.preventDefault();
        setHighlightedSlashIdx((prev) => (prev + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp" && options.length > 0) {
        e.preventDefault();
        setHighlightedSlashIdx((prev) => (prev - 1 + options.length) % options.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && options.length > 0) {
        e.preventDefault();
        selectSlashWorkflowByIndex(highlightedSlashIdx());
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        const current = input();
        setInput(current.startsWith("/") ? current.slice(1) : current);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Get currently selected parsed model object for the UI
  const currentSelectionObj = () => {
    if (!selectedModelStr() || selectedModelStr() === AUTO_MODEL_SELECTION) return null;
    const parts = selectedModelStr().split(":::");
    const providerId = parts[0];
    const modelName = parts[1];
    return aggregatedModels()?.find(m => m.providerId === providerId && m.modelName === modelName);
  };
  const currentSelectionLabel = createMemo(() => {
    if (selectedModelStr() === AUTO_MODEL_SELECTION) return "Auto (Agent picks best model)";
    const selected = currentSelectionObj();
    if (selected) return `${prettyProviderName(selected.providerName)}: ${selected.modelName}`;
    return "Select Model";
  });
  const providerTabs = createMemo(() => {
    const fromModels = (aggregatedModels() || []).map((m) => normalizeProviderName(m.providerName));
    const fromProviders = (providers() || []).map((p: any) => normalizeProviderName(p.provider));
    const unique = Array.from(new Set([...fromModels, ...fromProviders]));
    return ["all", ...unique];
  });
  const filteredModels = createMemo(() => {
    const models = aggregatedModels() || [];
    const byTab = modelProviderTab() === "all"
      ? models
      : models.filter((m) => m.providerName === modelProviderTab());
    const q = modelSearchQuery().trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter((m) => m.modelName.toLowerCase().includes(q));
  });
  const modelDropdownOptions = createMemo(() => {
    const rows = filteredModels();
    const q = modelSearchQuery().trim().toLowerCase();
    const includeAuto =
      modelProviderTab() === "all" &&
      (!q || "auto".includes(q) || "agent".includes(q) || "best model".includes(q));
    if (!includeAuto) return rows;
    return [{ providerId: "auto", providerName: "auto", modelName: "auto" }, ...rows];
  });
  const slashQuery = createMemo(() => {
    const value = input();
    if (!value.startsWith("/")) return null;
    return value.slice(1).trim().toLowerCase();
  });
  const slashWorkflowOptions = createMemo(() => {
    const query = slashQuery();
    if (query === null) return [];
    const all = (allWorkflows() || []).filter((wf) => wf.enabled && !wf.archived);
    if (!query) return all.slice(0, 8);
    return all
      .filter((wf) => {
        const key = (wf.key || "").toLowerCase();
        const name = (wf.name || "").toLowerCase();
        return key.includes(query) || name.includes(query);
      })
      .slice(0, 8);
  });
  const showSlashMenu = createMemo(() => slashQuery() !== null);

  /**
   * Handles select slash workflow by index.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param index - Value passed to selectSlashWorkflowByIndex.
   * @returns The value returned by selectSlashWorkflowByIndex.
   *
   * @example
   * ```typescript
   * const output = selectSlashWorkflowByIndex(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function selectSlashWorkflowByIndex(index: number) {
    const options = slashWorkflowOptions();
    if (!options.length) return;
    const safe = Math.min(Math.max(index, 0), options.length - 1);
    const chosen = options[safe];
    setInput(`Run workflow: ${chosen.key}`);
    setHighlightedSlashIdx(0);
  }

  createEffect(() => {
    void slashQuery();
    setHighlightedSlashIdx(0);
  });
  const chatScaleStyle = createMemo(() => ({ "font-size": `${chatFontScale()}%` }));
  const adjustChatFontScale = (delta: number) => {
    setChatFontScale((prev) => Math.min(130, Math.max(85, prev + delta)));
  };

  return (
    <>
      <Title>Chat — AutoPilot</Title>
      <main class="flex-1 flex h-full min-w-0 bg-[#111111]">

        {/* Thread sidebar */}
        <div class={`hidden md:flex flex-col shrink-0 bg-[#0a0a0a] transition-[width,border] duration-300 overflow-hidden ${isSidebarOpen() ? "w-[272px] border-r border-neutral-800/30" : "w-0 border-r-0 border-transparent"}`}>
          <div class="w-[272px] h-full flex flex-col">
            {/* Header */}
            <div class="px-4 py-4 flex items-center justify-between shrink-0">
              <span class="text-[13px] uppercase tracking-[0.14em] text-neutral-200 font-semibold">Threads</span>
              <div class="flex items-center gap-1">
                <button
                  onClick={newThread}
                  class="p-1.5 text-neutral-300 hover:text-white hover:bg-white/8 rounded-lg transition-all duration-200"
                  title="New thread"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>

                {/* Fire button — clear all */}
                <button
                  onClick={() => setConfirmModal({ type: "clear-all" })}
                  class="p-1.5 text-neutral-400 hover:text-orange-300 hover:bg-orange-500/10 rounded-lg transition-all duration-200"
                  title="Clear all threads"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
                </button>

                <button
                  onClick={() => setIsSidebarOpen(false)}
                  class="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-white/8 rounded-lg transition-all duration-200"
                  title="Close sidebar"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><path d="M9 3v18" /><path d="m16 15-3-3 3-3" /></svg>
                </button>
              </div>
            </div>

            {/* Thread list */}
            <div class={`flex-1 overflow-y-auto px-2 pb-3 space-y-px ${isBurning() ? "threads-burn-out" : ""}`}>
              <Show when={threads.loading}>
                <div class="px-3 py-4 text-xs text-neutral-500">Loading...</div>
              </Show>
              <Show when={!threads.loading && (threads() || []).length === 0}>
                <div class="flex flex-col items-center justify-center py-12 gap-3">
                  <div class="w-10 h-10 rounded-xl bg-neutral-800/50 flex items-center justify-center">
                    <svg class="text-neutral-600" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  </div>
                  <p class="text-[12px] text-neutral-600">No conversations yet</p>
                </div>
              </Show>
              <For each={threads() || []}>
                {(thread) => (
                  <div
                    class={`group relative w-full flex items-center rounded-xl transition-all duration-200 ${activeThreadId() === thread.id
                      ? "bg-white/[0.07]"
                      : "hover:bg-white/[0.04]"
                      }`}
                  >
                    {/* Rename inline editor / thread title */}
                    <Show
                      when={editingThreadId() === thread.id}
                      fallback={
                        <button
                          onClick={() => selectThread(thread.id)}
                          class="flex-1 flex items-center gap-2.5 text-left px-3 py-2.5 min-w-0"
                        >
                          <svg class={`shrink-0 ${activeThreadId() === thread.id ? "text-neutral-300" : "text-neutral-500"}`} xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                          <p class={`truncate text-[14px] ${activeThreadId() === thread.id ? "text-neutral-100 font-medium" : "text-neutral-400 group-hover:text-neutral-200"
                            }`}>{thread.title}</p>
                        </button>
                      }
                    >
                      <input
                        class="flex-1 mx-2 my-1 px-2.5 py-1.5 text-[14px] bg-neutral-900 border border-neutral-700/50 rounded-lg text-neutral-100 focus:outline-none focus:border-indigo-500/50 transition-colors"
                        maxLength={50}
                        value={renameValue()}
                        onInput={(e) => setRenameValue(e.currentTarget.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") { e.preventDefault(); await commitRename(thread.id); }
                          if (e.key === "Escape") setEditingThreadId(null);
                        }}
                        onBlur={() => commitRename(thread.id)}
                        ref={(el) => setTimeout(() => el?.focus(), 30)}
                      />
                    </Show>

                    {/* ⋮ menu — only when not editing */}
                    <Show when={editingThreadId() !== thread.id}>
                      <div class="relative shrink-0 pr-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                        <button
                          onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId() === thread.id ? null : thread.id); }}
                          class="p-1 rounded-lg text-neutral-600 hover:text-neutral-300 hover:bg-white/5 transition-all duration-200"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                          </svg>
                        </button>
                        <Show when={menuOpenId() === thread.id}>
                          <div class="absolute right-0 top-7 z-50 w-36 bg-[#1a1a1a] border border-neutral-800/60 rounded-xl shadow-2xl shadow-black/60 py-1 text-xs animate-fade-in">
                            <button
                              class="w-full text-left px-3 py-2 text-neutral-400 hover:bg-white/5 hover:text-white transition-all duration-150 flex items-center gap-2"
                              onClick={(e) => { e.stopPropagation(); setRenameValue(thread.title); setEditingThreadId(thread.id); setMenuOpenId(null); }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              Rename
                            </button>
                            <button
                              class="w-full text-left px-3 py-2 text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-all duration-150 flex items-center gap-2"
                              onClick={(e) => { e.stopPropagation(); setConfirmModal({ type: "delete", threadId: thread.id }); setMenuOpenId(null); }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                              Delete
                            </button>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        {/* Chat area */}
        <div class="flex-1 flex flex-col min-w-0 bg-[#111111] relative">

          {/* Floating Transparent Toggle Icon */}
          <Show when={!isSidebarOpen()}>
            <button
              onClick={() => setIsSidebarOpen(true)}
              class="absolute top-3 left-3 z-50 p-2 text-neutral-500 hover:text-neutral-200 bg-[#1a1a1a]/80 hover:bg-[#1a1a1a] backdrop-blur-md shadow-lg shadow-black/30 border border-neutral-800/30 rounded-xl transition-all duration-200 cursor-pointer"
              title="Open sidebar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><path d="M9 3v18" /><path d="m14 9 3 3-3 3" /></svg>
            </button>
          </Show>

          {/* Header */}
          <header class="px-3 md:px-5 py-3 flex items-center justify-between shrink-0 min-h-[52px]">
            <div class={`flex items-center gap-1 md:gap-2 transition-[margin] duration-300 ${!isSidebarOpen() ? "md:ml-12" : ""}`}>

              {/* Mobile Sidebar Toggle */}
              <button
                onClick={() => mobileMenu.toggle()}
                class="md:hidden p-2 -ml-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
              </button>

              <Show when={!aggregatedModels.loading} fallback={
                <div class="text-[14px] text-neutral-600 animate-pulse px-3 py-1.5">Loading Models...</div>
              }>
                <Show when={aggregatedModels() && aggregatedModels()!.length > 0} fallback={
                  <div class="text-[14px] text-red-400/80 px-3 py-1.5">No models available.</div>
                }>
                  {/* Modern Custom Dropdown */}
                  <div class="relative group">
                    <button
                      onClick={() => {
                        const next = !isModelDropdownOpen();
                        setIsModelDropdownOpen(next);
                        if (next) {
                          setModelProviderTab("all");
                          setShowModelSearch(false);
                          setModelSearchQuery("");
                        }
                      }}
                      class="relative bg-transparent flex items-center gap-1.5 md:gap-2 text-[14px] md:text-[17px] font-medium text-neutral-300 hover:text-white hover:bg-white/5 pl-1.5 pr-7 md:pl-3 md:pr-9 py-1.5 rounded-xl transition-all duration-200 cursor-pointer focus:outline-none max-w-[170px] sm:max-w-[220px] md:max-w-none text-left"
                    >
                      <span class="truncate block w-full">{currentSelectionLabel()}</span>
                      <div class="absolute inset-y-0 right-1.5 md:right-2.5 flex items-center text-neutral-500 pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </div>
                    </button>

                    <Show when={isModelDropdownOpen()}>
                      {/* Invisible backdrop to close on click outside */}
                      <div class="fixed inset-0 z-40" onClick={() => setIsModelDropdownOpen(false)}></div>

                      {/* Dropdown Menu - glass effect, nice border, bounded width for mobile */}
                      <div class="absolute top-full left-0 mt-1.5 w-[360px] max-w-[calc(100vw-24px)] z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-neutral-800/40 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.6)] overflow-hidden">
                        <div class="px-3 pt-2 pb-0 border-b border-neutral-800/60">
                          <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-4 overflow-x-auto scrollbar-thin pr-1">
                              <For each={providerTabs()}>
                                {(tab) => (
                                  <button
                                    onClick={() => setModelProviderTab(tab)}
                                    class={`relative pb-2 text-xs whitespace-nowrap transition-all duration-150 border-b-2 ${modelProviderTab() === tab
                                        ? "text-neutral-100 border-neutral-100"
                                        : "text-neutral-500 border-transparent hover:text-neutral-300"
                                      }`}
                                  >
                                    {tab === "all" ? "All" : prettyProviderName(tab)}
                                  </button>
                                )}
                              </For>
                            </div>

                            <button
                              onClick={() => {
                                const next = !showModelSearch();
                                setShowModelSearch(next);
                                if (!next) setModelSearchQuery("");
                              }}
                              class={`mb-2 shrink-0 rounded-md p-1.5 transition-colors ${showModelSearch()
                                  ? "text-neutral-100 bg-white/10"
                                  : "text-neutral-500 hover:text-neutral-300 hover:bg-white/5"
                                }`}
                              title="Search models"
                              aria-label="Search models"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.3-4.3" />
                              </svg>
                            </button>
                          </div>

                          <Show when={showModelSearch()}>
                            <div class="pt-2 pb-2">
                              <input
                                type="text"
                                value={modelSearchQuery()}
                                onInput={(e) => setModelSearchQuery(e.currentTarget.value)}
                                placeholder="Filter models by name..."
                                class="w-full h-8 rounded-lg border border-neutral-800/80 bg-neutral-900/80 px-2.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600"
                              />
                            </div>
                          </Show>
                        </div>

                        {/* 6 items * ~40px + padding = 250px max height */}
                        <div class="max-h-[250px] overflow-y-auto scrollbar-custom py-2 flex flex-col">
                          <Show when={modelDropdownOptions().length > 0} fallback={
                            <div class="px-4 py-5 text-xs text-neutral-500">No models in this provider.</div>
                          }>
                            <For each={modelDropdownOptions()}>
                              {(m, i) => {
                                const val = `${m.providerId}:::${m.modelName}`;
                                const isSelected = selectedModelStr() === val;
                                const isAuto = m.providerId === "auto" && m.modelName === "auto";
                                const showAutoDivider = isAuto && i() === 0 && modelDropdownOptions().length > 1;
                                return (
                                  <>
                                    <button
                                      onClick={() => { setSelectedModelStr(val); setIsModelDropdownOpen(false); }}
                                      class={`w-full flex items-start gap-2.5 text-left px-4 py-2 transition-all duration-150 text-[14px] ${isSelected
                                          ? "bg-indigo-600/15 text-indigo-300"
                                          : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                                        }`}
                                    >
                                      <Show when={isSelected} fallback={<div class="w-4 h-4 mt-0.5 shrink-0"></div>}>
                                        <svg class="shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                      </Show>
                                      <div class="min-w-0 flex-1">
                                        <Show
                                          when={!isAuto}
                                          fallback={
                                            <div class="flex flex-col">
                                              <span class="font-medium truncate">Auto (Agent decides each turn)</span>
                                              <span class="text-[11px] text-neutral-500 truncate">
                                                Routes to the best available provider/model and can fail over automatically.
                                              </span>
                                            </div>
                                          }
                                        >
                                          <span class="truncate font-medium">
                                            {prettyProviderName(m.providerName)}: {m.modelName}
                                          </span>
                                        </Show>
                                      </div>
                                    </button>
                                    <Show when={showAutoDivider}>
                                      <div class="my-1 mx-4 border-t border-neutral-800/70" />
                                    </Show>
                                  </>
                                );
                              }}
                            </For>
                          </Show>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <button
                onClick={() => setIsCustomizePanelOpen(true)}
                class="w-9 h-9 rounded-lg border border-neutral-800/70 bg-neutral-900/70 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 hover:bg-neutral-800/80 transition-colors flex items-center justify-center"
                title="Customize chat"
                aria-label="Customize chat"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14"></line>
                  <line x1="4" y1="10" x2="4" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12" y2="3"></line>
                  <line x1="20" y1="21" x2="20" y2="16"></line>
                  <line x1="20" y1="12" x2="20" y2="3"></line>
                  <line x1="2" y1="14" x2="6" y2="14"></line>
                  <line x1="10" y1="8" x2="14" y2="8"></line>
                  <line x1="18" y1="16" x2="22" y2="16"></line>
                </svg>
              </button>
            </div>
          </header>

          {/* Main Layout Area below header */}
          <div class={`flex-1 flex flex-col w-full h-full overflow-hidden ${(messages().length === 0 && !streamMsg.active) ? "justify-center" : ""}`}>

            {/* Message feed — visible when there are messages or a streaming response is in flight */}
            <div
              ref={feedRef}
              onScroll={updateScrollToBottomVisibility}
              class={`overflow-y-auto scroll-smooth ${(messages().length === 0 && !streamMsg.active) ? "hidden" : "flex-1 pb-2"}`}
              style={chatScaleStyle()}
            >
              <div class="chat-feed w-full max-w-6xl mx-auto px-4 md:px-5 py-6 min-h-full">

                <For each={messages()}>
                  {(msg, index) => (
                    <MessageBubble
                      messageId={msg.id}
                      role={msg.role}
                      content={msg.content}
                      attachments={msg.attachments}
                      textScale={chatFontScale()}
                      blocks={msg.role === "assistant" ? getAssistantBlocks(msg) : undefined}
                      state="completed"
                      onTaskOpen={openTaskDetails}
                      onWorkflowOpen={openWorkflowDetails}
                      onAction={handleAction}
                      onQuestionAnswer={handleQuestionAnswer}
                      onRetry={msg.role === "assistant" ? () => {
                        const allMsgs = messages();
                        const lastUser = [...allMsgs].slice(0, index()).reverse().find(m => m.role === "user");
                        if (lastUser) sendMessage(lastUser.content);
                      } : undefined}
                      onEdit={msg.role === "user" ? (newText: string) => sendMessage(newText) : undefined}
                    />
                  )}
                </For>

                {/* Streaming in-flight assistant message — rendered from store for granular updates */}
                <Show when={streamMsg.active}>
                  <MessageBubble
                    messageId={streamMsg.id}
                    role="assistant"
                    textScale={chatFontScale()}
                    blocks={streamMsg.blocks}
                    state={streamMsg.state}
                    streamingBlockIdx={streamMsg.streamingBlockIdx}
                    onAction={handleAction}
                    onQuestionAnswer={handleQuestionAnswer}
                    onTaskOpen={openTaskDetails}
                    onWorkflowOpen={openWorkflowDetails}
                  />
                </Show>

              </div>
            </div>

            {/* Chat Centered Empty State (AutoPilot Intro) */}
            <Show when={messages().length === 0 && !streamMsg.active}>
              <div class="flex flex-col items-center gap-4 text-center w-full min-h-0 mb-6" style={chatScaleStyle()}>
                <div class="flex items-center gap-3">
                  <div class="w-12 h-12 rounded-2xl bg-indigo-600/95 flex items-center justify-center shadow-[0_0_26px_rgba(99,102,241,0.4)] border border-indigo-400/20 shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                  </div>
                  <span class="text-[24px] font-bold text-neutral-100 tracking-tight">AutoPilot</span>
                </div>
                <h2 class="text-[26px] font-semibold text-neutral-300 tracking-tight">What can I automate for you?</h2>
              </div>
            </Show>



            {/* Composer Wrapper */}
            <div class={`relative shrink-0 w-full flex flex-col transition-all duration-300 ${(messages().length === 0 && !streamMsg.active) ? "max-w-[920px] mx-auto px-4 md:px-5 pb-safe" : "px-4 md:px-5 pb-safe-sm pt-1 md:pt-0"}`}>



              <div class={`w-full flex flex-col items-center`}>
                <div class={`w-full ${(messages().length === 0 && !streamMsg.active) ? "" : "max-w-[920px] mx-auto"}`}>

                  {/* Scroll to bottom — mobile only, centered above prompt box, transparent */}
                  <Show when={showScrollToBottom() && (messages().length > 0 || streamMsg.active)}>
                    <div class="flex md:hidden justify-center w-full pb-1.5">
                      <button
                        onClick={() => scrollFeed()}
                        class="flex items-center justify-center w-9 h-9 rounded-full bg-transparent text-neutral-400 hover:text-white transition-all duration-200"
                        aria-label="Scroll to latest message"
                        title="Scroll to latest message"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 5v14" /><path d="m5 12 7 7 7-7" />
                        </svg>
                      </button>
                    </div>
                  </Show>

                  {/* Flex row: prompt box + scroll-to-bottom beside it on desktop */}
                  <div class="w-full flex items-end md:items-center gap-2">
                    <div class="w-full min-w-0 relative flex flex-col gap-1 rounded-3xl bg-[#1e1e1e] border border-neutral-700/60 px-2.5 py-2.5 shadow-[0_4px_24px_rgba(0,0,0,0.35)] transition-all duration-300 hover:border-neutral-600/70 focus-within:border-neutral-500/80 focus-within:bg-[#242424] focus-within:shadow-[0_8px_32px_rgba(0,0,0,0.5)]">

                      {/* ChatGPT-style Attachment Chips */}
                      <Show when={pendingFiles().length > 0}>
                        <div class="flex flex-wrap gap-3 pt-2 px-2 pb-1">
                          <For each={pendingFiles()}>
                            {(file, idx) => {
                              const isSpreadsheet = file.name.match(/\.(csv|xlsx|xls)$/i);
                              const isImage = file.name.match(/\.(png|jpe?g|webp|gif|svg)$/i);
                              const isPdf = file.name.match(/\.pdf$/i);
                              const iconColor = isSpreadsheet ? "bg-emerald-500/20 text-emerald-400" : isPdf ? "bg-rose-500/20 text-rose-400" : isImage ? "bg-blue-500/20 text-blue-400" : "bg-indigo-500/20 text-indigo-400";
                              const label = isSpreadsheet ? "Spreadsheet" : isPdf ? "PDF Document" : isImage ? "Image" : "Document";
                              return (
                                <div class="relative flex items-center gap-3 bg-[#2a2a2c] border border-neutral-700/50 rounded-xl p-2 pr-4 max-w-[240px] shadow-sm">
                                  <div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
                                    {isSpreadsheet ? (
                                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" class="opacity-90" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                                    ) : isImage ? (
                                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" class="opacity-90" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                                    ) : (
                                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" class="opacity-90" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                    )}
                                  </div>
                                  <div class="flex flex-col min-w-0 pr-2">
                                    <span class="text-sm font-medium text-neutral-200 truncate">{file.name}</span>
                                    <span class="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold mt-0.5">{label}</span>
                                  </div>
                                  <button
                                    class="absolute -top-1.5 -right-1.5 w-[22px] h-[22px] bg-neutral-600 text-neutral-200 rounded-full flex items-center justify-center hover:bg-neutral-400 hover:text-white shadow-md border border-[#1e1e1e] transition-colors z-10 opacity-80 hover:opacity-100"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setPendingFiles((prev) => prev.filter((_, i) => i !== idx()));
                                    }}
                                    aria-label={`Remove ${file.name}`}
                                  >
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                  </button>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>

                      <div class="flex items-end gap-2 w-full px-1.5">
                        <Show when={showSlashMenu()}>
                          <div class="absolute left-0 right-0 bottom-[calc(100%+10px)] z-40 rounded-2xl border border-neutral-700/90 bg-[#121314] shadow-[0_10px_28px_rgba(0,0,0,0.42)] overflow-hidden">
                            <div class="px-3 py-2.5 border-b border-neutral-800/80 flex items-center justify-between gap-3">
                              <p class="text-[11px] uppercase tracking-[0.14em] text-neutral-400 font-medium">Workflows</p>
                              <p class="text-[10px] text-neutral-500">↑ ↓ Enter</p>
                            </div>
                            <Show
                              when={slashWorkflowOptions().length > 0}
                              fallback={
                                <p class="px-3 py-3 text-sm text-neutral-500">
                                  {allWorkflows.loading ? "Loading workflows..." : "No workflow matched your slash query."}
                                </p>
                              }
                            >
                              <div class="max-h-[260px] overflow-y-auto p-1.5" role="listbox" aria-label="Workflow slash suggestions">
                                <For each={slashWorkflowOptions()}>
                                  {(wf, idx) => (
                                    <button
                                      onMouseDown={(ev) => ev.preventDefault()}
                                      onMouseEnter={() => setHighlightedSlashIdx(idx())}
                                      onClick={() => selectSlashWorkflowByIndex(idx())}
                                      role="option"
                                      aria-selected={highlightedSlashIdx() === idx()}
                                      class={`w-full text-left px-3 py-2.5 rounded-xl transition-colors duration-120 relative mb-1 last:mb-0 border ${highlightedSlashIdx() === idx()
                                          ? "bg-neutral-800/95 text-neutral-100 border-neutral-600/80"
                                          : "text-neutral-300 border-transparent hover:bg-neutral-900 hover:border-neutral-700/80"
                                        }`}
                                    >
                                      <div class="flex items-center justify-between gap-3">
                                        <div class="min-w-0">
                                          <p class={`text-sm font-medium truncate ${highlightedSlashIdx() === idx() ? "text-white" : "text-neutral-100"}`}>{wf.name}</p>
                                          <p class={`text-xs truncate ${highlightedSlashIdx() === idx() ? "text-neutral-300" : "text-neutral-500"}`}>/{wf.key}</p>
                                        </div>
                                        <span
                                          class={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${highlightedSlashIdx() === idx()
                                              ? "text-neutral-100 border-neutral-500 bg-neutral-700/70"
                                              : "text-neutral-400 border-neutral-700/80 bg-neutral-900/70"
                                            }`}
                                        >
                                          Run
                                        </span>
                                      </div>
                                    </button>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </Show>

                        {/* Left Attachment Button (+) */}
                        <button
                          onClick={() => attachmentInputRef?.click()}
                          class="shrink-0 flex items-center justify-center w-9 h-9 text-white hover:bg-neutral-700/50 rounded-full transition-all duration-200 mb-0.5"
                          title="Attach files"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                        <input
                          ref={attachmentInputRef}
                          type="file"
                          multiple
                          class="hidden"
                          onChange={onSelectFiles}
                        />

                        {/* Textarea */}
                        <textarea
                          ref={composerTextareaRef}
                          rows="1"
                          placeholder={composerHints[placeholderHintIndex()]}
                          value={input()}
                          onInput={(e) => {
                            setInput(e.currentTarget.value);
                            e.currentTarget.style.height = "auto";
                            e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 250) + "px";
                          }}
                          onKeyDown={handleKey}
                          class="flex-1 bg-transparent text-[16px] text-neutral-100 resize-none focus:outline-none placeholder:text-neutral-400 placeholder:font-normal leading-[24px] min-h-[24px] max-h-56 py-[6px] mb-0.5 scrollbar-custom"
                        />

                        {/* Right Side Actions */}
                        <div class="flex items-center gap-1.5 shrink-0 mb-0.5">

                          {/* Send / Enter Button */}
                          <div class="shrink-0 ml-0.5">
                            <button
                              onClick={() => sendMessage()}
                              disabled={(!input().trim() && pendingFiles().length === 0) || sending()}
                              class={`flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200 ${(input().trim() || pendingFiles().length > 0) && !sending()
                                ? "bg-white text-black hover:bg-neutral-200"
                                : "bg-[#2a2a2a] text-neutral-500/80 hover:bg-neutral-700/60 hover:text-neutral-300"
                                }`}
                            >
                              <Show when={sending()} fallback={
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                  <line x1="12" y1="19" x2="12" y2="5"></line>
                                  <polyline points="5 12 12 5 19 12"></polyline>
                                </svg>
                              }>
                                <svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                              </Show>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Scroll to bottom — desktop only, side-by-side with prompt box */}
                    <Show when={showScrollToBottom() && (messages().length > 0 || streamMsg.active)}>
                      <button
                        onClick={() => scrollFeed()}
                        class="hidden md:flex shrink-0 items-center justify-center w-9 h-9 rounded-full border border-neutral-700/60 bg-[#1e1e1e] text-neutral-400 hover:text-white hover:bg-[#252525] hover:border-neutral-500/50 shadow-lg transition-all duration-200"
                        aria-label="Scroll to latest message"
                        title="Scroll to latest message"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 5v14" /><path d="m5 12 7 7 7-7" />
                        </svg>
                      </button>
                    </Show>

                  </div> {/* end flex row */}
                  <Show when={uploadingAttachments() || composerError()}>
                    <div class="mt-2 px-1">
                      <Show when={uploadingAttachments()}>
                        <p class="text-xs text-neutral-500 mt-1">Uploading attachments…</p>
                      </Show>
                      <Show when={composerError()}>
                        <p class="text-xs text-red-400 mt-1">{composerError()}</p>
                      </Show>
                    </div>
                  </Show>

                  {/* Suggestions (Only visible when empty) */}
                  <Show when={messages().length === 0 && !streamMsg.active}>
                    <div class="w-full grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-4 px-2" style={chatScaleStyle()}>
                      <div onClick={() => sendMessage("Add task: Reply to Sarah Jenkins about contract changes by 5 PM")} class="bg-[#2a2a2a] border border-neutral-700/30 hover:border-indigo-500/30 hover:bg-[#323232] transition-all duration-200 p-3 rounded-xl cursor-pointer group">
                        <div class="flex items-center gap-1.5 mb-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                          <h4 class="text-[13px] font-medium text-neutral-200 group-hover:text-white transition-colors">Add task</h4>
                        </div>
                        <p class="text-[11px] text-neutral-400 leading-relaxed">Reply to Sarah Jenkins by 5 PM</p>
                      </div>
                      <div onClick={() => sendMessage("Run workflow: triage unread support emails and draft responses")} class="bg-[#2a2a2a] border border-neutral-700/30 hover:border-indigo-500/30 hover:bg-[#323232] transition-all duration-200 p-3 rounded-xl cursor-pointer group">
                        <div class="flex items-center gap-1.5 mb-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg>
                          <h4 class="text-[13px] font-medium text-neutral-200 group-hover:text-white transition-colors">Run workflow</h4>
                        </div>
                        <p class="text-[11px] text-neutral-400 leading-relaxed">Triage unread support emails</p>
                      </div>
                      <div onClick={() => sendMessage("Check emails from Gmail and summarize any urgent actions")} class="bg-[#2a2a2a] border border-neutral-700/30 hover:border-indigo-500/30 hover:bg-[#323232] transition-all duration-200 p-3 rounded-xl cursor-pointer group">
                        <div class="flex items-center gap-1.5 mb-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
                          <h4 class="text-[13px] font-medium text-neutral-200 group-hover:text-white transition-colors">Check emails</h4>
                        </div>
                        <p class="text-[11px] text-neutral-400 leading-relaxed">Summarize urgent actions from Gmail</p>
                      </div>
                    </div>
                  </Show>

                  <p class="text-center text-[12px] text-neutral-500 mt-3 tracking-wide">AI agents can make mistakes. Always verify sensitive actions.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Show when={isCustomizePanelOpen()}>
        <div class="fixed inset-0 z-[105]">
          <button
            class="absolute inset-0 bg-black/40"
            aria-label="Close customization panel"
            onClick={() => setIsCustomizePanelOpen(false)}
          />
          <aside class="absolute right-0 top-0 h-full w-[320px] border-l border-neutral-800/70 bg-[#0f0f11] shadow-2xl shadow-black/70 p-5 flex flex-col">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold text-neutral-100">Customize Chat</h3>
              <button
                onClick={() => setIsCustomizePanelOpen(false)}
                class="w-8 h-8 rounded-lg border border-neutral-800/70 bg-neutral-900/70 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 transition-colors flex items-center justify-center"
                aria-label="Close customization panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <p class="text-xs text-neutral-500 mt-1">Adjust chat text scaling for readability.</p>

            <div class="mt-5 rounded-xl border border-neutral-800/70 bg-[linear-gradient(180deg,rgba(28,28,33,0.82),rgba(18,18,20,0.86))] p-4">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-neutral-300">Text size</span>
                <span class="text-xs text-neutral-400">{chatFontScale()}%</span>
              </div>

              <div class="mt-3 flex items-center gap-2">
                <button
                  onClick={() => adjustChatFontScale(-5)}
                  disabled={chatFontScale() <= 85}
                  class="w-9 h-9 rounded-lg border border-neutral-700/80 bg-neutral-900/80 text-neutral-300 hover:text-white hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Decrease chat text size"
                >
                  A-
                </button>
                <input
                  type="range"
                  min="85"
                  max="130"
                  step="1"
                  value={chatFontScale()}
                  onInput={(e) => setChatFontScale(Number(e.currentTarget.value))}
                  class="flex-1 accent-indigo-500"
                  aria-label="Chat text size scale"
                />
                <button
                  onClick={() => adjustChatFontScale(5)}
                  disabled={chatFontScale() >= 130}
                  class="w-9 h-9 rounded-lg border border-neutral-700/80 bg-neutral-900/80 text-neutral-300 hover:text-white hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Increase chat text size"
                >
                  A+
                </button>
              </div>

              <div class="mt-3 flex items-center justify-end">
                <button
                  onClick={() => setChatFontScale(100)}
                  class="text-xs px-3 py-1.5 rounded-lg border border-neutral-700/80 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-900/80 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          </aside>
        </div>
      </Show>

      {/* Confirmation Modal */}
      <Show when={confirmModal()}>
        {(modal) => {
          const threadTitle = () => {
            if (modal().type === "delete" && modal().threadId) {
              const t = (threads() || []).find((th) => th.id === modal().threadId);
              return t?.title || "this thread";
            }
            return "";
          };
          return (
            <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmModal(null)}>
              <div class="bg-[#1a1a1a] border border-neutral-800/60 rounded-2xl shadow-2xl shadow-black/80 p-8 w-[420px] animate-fade-in" onClick={(e) => e.stopPropagation()}>
                <div class="flex items-center gap-4 mb-5">
                  <div class={`w-11 h-11 rounded-xl flex items-center justify-center ${modal().type === "clear-all" ? "bg-orange-500/15" : "bg-red-500/15"}`}>
                    <Show when={modal().type === "clear-all"} fallback={
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                    }>
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
                    </Show>
                  </div>
                  <div>
                    <h3 class="text-[16px] font-semibold text-white">
                      {modal().type === "clear-all" ? "Clear all threads?" : "Delete thread?"}
                    </h3>
                    <p class="text-[13px] text-neutral-500 mt-1">
                      {modal().type === "clear-all"
                        ? "All threads will be permanently removed."
                        : <>Delete "<span class="text-neutral-400">{threadTitle()}</span>"?</>}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-3 justify-end mt-6">
                  <button
                    onClick={() => setConfirmModal(null)}
                    class="px-5 py-2 text-[13px] text-neutral-400 hover:text-white bg-neutral-800/50 hover:bg-neutral-700/60 rounded-lg transition-all duration-150"
                  >Cancel</button>
                  <button
                    onClick={async () => {
                      if (modal().type === "clear-all") {
                        await clearAllThreads();
                      } else if (modal().threadId) {
                        await confirmDelete(modal().threadId!);
                      }
                    }}
                    class={`px-5 py-2 text-[13px] font-medium rounded-lg transition-all duration-150 ${modal().type === "clear-all"
                        ? "bg-orange-600 hover:bg-orange-500 text-white"
                        : "bg-red-500/80 hover:bg-red-500/90 text-white"
                      }`}
                  >{modal().type === "clear-all" ? "Clear all" : "Delete"}</button>
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </>
  );
}

export default function Home() {
  return <ChatPage />;
}
