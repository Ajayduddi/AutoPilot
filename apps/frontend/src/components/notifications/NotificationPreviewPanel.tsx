import { For, Show, createResource, createSignal } from "solid-js";
import { Button } from "../ui/Button";
import { workflowsApi } from "../../lib/api";
import { usePanel } from "../../context/panel.context";
import type { InboxNotification } from "../../context/notifications.context";
import { getNotificationDisplayTitle, getWorkflowInsight } from "../../lib/notification-insights";

/**
 * Interface describing notification preview panel props shape.
 */
interface NotificationPreviewPanelProps {
  notification: InboxNotification;
  onOpenWorkflow?: (workflowId: string) => void;
  onOpenApprovals?: () => void;
  onFollowUp?: (question?: string) => void;
}
const runStatusConfig: Record<string, { label: string; pill: string; dot: string }> = {
  running: {
    label: "Running",
    pill: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    dot: "bg-blue-500 animate-pulse",
  },
  completed: {
    label: "Completed",
    pill: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    dot: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    pill: "text-red-400 bg-red-500/10 border-red-500/20",
    dot: "bg-red-500",
  },
  waiting_approval: {
    label: "Awaiting Approval",
    pill: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    dot: "bg-amber-500 animate-pulse",
  },
  queued: {
    label: "Queued",
    pill: "text-neutral-300 bg-neutral-500/10 border-neutral-500/20",
    dot: "bg-neutral-500 animate-pulse",
  },
};

/**
 * Utility function to format date time.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for formatDateTime.
 * @returns Return value from formatDateTime.
 *
 * @example
 * ```typescript
 * const output = formatDateTime(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
}

/**
 * Utility function to format duration.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for formatDuration.
 * @returns Return value from formatDuration.
 *
 * @example
 * ```typescript
 * const output = formatDuration(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return "Not available";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

/**
 * Utility function to notification preview panel.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for NotificationPreviewPanel.
 * @returns Return value from NotificationPreviewPanel.
 *
 * @example
 * ```typescript
 * const output = NotificationPreviewPanel(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function NotificationPreviewPanel(props: NotificationPreviewPanelProps) {
  const { closePanel } = usePanel();
  const [showRaw, setShowRaw] = createSignal(false);
  const [followUpQuestion, setFollowUpQuestion] = createSignal("");
  const [runDetail] = createResource(
    () => (props.notification.type === "workflow_event" ? props.notification.runId : undefined),
    (runId) => workflowsApi.getRunById(runId, true),
  );
  const insight = () => getWorkflowInsight(props.notification);
  const runStatus = () => {
    const status = runDetail()?.status || "queued";
    return runStatusConfig[status] || runStatusConfig.queued;
  };
  const openWorkflowRoute = () => {
    const workflowId = runDetail()?.workflowId;
    if (!workflowId) return;
    closePanel();
    props.onOpenWorkflow?.(workflowId);
  };
  const openApprovals = () => {
    closePanel();
    props.onOpenApprovals?.();
  };
  const submitFollowUp = () => {
    const question = followUpQuestion().trim();
    if (!question) return;
    closePanel();
    props.onFollowUp?.(question);
  };

  return (
    <div class="space-y-5">
      <div class="space-y-2">
        <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Overview</p>
        <div class="rounded-2xl border border-neutral-800/70 bg-neutral-900/55 px-4 py-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-base font-semibold text-neutral-100 leading-snug">{getNotificationDisplayTitle(props.notification)}</h3>
              <Show when={props.notification.message}>
                <p class="mt-2 text-sm text-neutral-300 leading-relaxed">{props.notification.message}</p>
              </Show>
            </div>
            <Show when={props.notification.type === "workflow_event" && runDetail()}>
              <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${runStatus().pill}`}>
                {runStatus().label}
              </span>
            </Show>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <span class="text-[11px] text-neutral-400 bg-neutral-800/80 px-2.5 py-1 rounded-lg">
              {formatDateTime(props.notification.createdAt)}
            </span>
            <Show when={props.notification.runId}>
              <span class="text-[11px] font-mono text-neutral-300 bg-neutral-800/80 px-2.5 py-1 rounded-lg">
                {props.notification.runId}
              </span>
            </Show>
          </div>

          <Show when={insight()?.summary || (insight()?.bullets && insight()!.bullets!.length > 0)}>
            <div class="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.04] px-3.5 py-3">
              <p class="text-[10px] uppercase tracking-[0.14em] text-blue-300 font-semibold">AI Summary</p>
              <Show when={insight()?.summary}>
                <p class="mt-2 text-sm text-neutral-200 leading-relaxed">{insight()?.summary}</p>
              </Show>
              <Show when={insight()?.bullets && insight()!.bullets!.length > 0}>
                <ul class="mt-2 space-y-1.5 text-xs text-neutral-300 list-disc pl-4">
                  <For each={insight()?.bullets || []}>
                    {(point) => <li>{point}</li>}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>

          <Show when={insight()?.rawPreview}>
            <div class="mt-3">
              <button
                onClick={() => setShowRaw((value) => !value)}
                class="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-800/60 transition-colors"
              >
                {showRaw() ? "Hide raw result" : "View raw result"}
              </button>
              <Show when={showRaw()}>
                <pre class="mt-2 text-xs text-neutral-300 bg-neutral-950/70 border border-neutral-800/70 rounded-xl p-3 overflow-x-auto max-h-52 whitespace-pre-wrap break-all">
                  {insight()?.rawPreview}
                </pre>
              </Show>
            </div>
          </Show>

          <Show when={insight()?.suggestedQuestions && insight()!.suggestedQuestions!.length > 0}>
            <div class="mt-4">
              <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">Suggested Follow-up</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <For each={insight()?.suggestedQuestions || []}>
                  {(question) => (
                    <button
                      onClick={() => {
                        closePanel();
                        props.onFollowUp?.(question);
                      }}
                      class="text-[11px] text-neutral-300 bg-neutral-800/70 border border-neutral-700/70 px-2.5 py-1 rounded-lg hover:text-white hover:border-blue-400/40 hover:bg-blue-500/10 transition-colors"
                    >
                      {question}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={insight()}>
            <div class="mt-4 space-y-2">
              <label class="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">Ask follow-up</label>
              <textarea
                value={followUpQuestion()}
                onInput={(event) => setFollowUpQuestion(event.currentTarget.value)}
                rows={3}
                placeholder="Ask a question about this result..."
                class="w-full resize-none rounded-xl border border-blue-500/25 bg-neutral-950/70 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-blue-400/55 focus:ring-2 focus:ring-blue-500/15"
              />
              <Button
                variant="ghost"
                size="sm"
                class="w-full border border-blue-500/25 bg-blue-500/10 text-blue-200 hover:bg-blue-500/15 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={submitFollowUp}
                disabled={!followUpQuestion().trim()}
              >
                Send followup
              </Button>
            </div>
          </Show>
        </div>
      </div>

      <Show when={props.notification.type === "workflow_event" && props.notification.runId}>
        <div class="space-y-3">
          <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Run Details</p>

          <Show
            when={!runDetail.loading}
            fallback={
              <div class="rounded-2xl border border-neutral-800/70 bg-neutral-900/50 px-4 py-4 flex items-center gap-2 text-sm text-neutral-400">
                <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Loading workflow run details...
              </div>
            }
          >
            <Show
              when={runDetail() && !runDetail.error}
              fallback={
                <div class="rounded-2xl border border-red-500/25 bg-red-500/5 px-4 py-4 text-sm text-red-300">
                  Could not load the related run details for this notification.
                </div>
              }
            >
              <div class="space-y-4">
                <div class="rounded-2xl border border-neutral-800/70 bg-neutral-900/55 px-4 py-4 space-y-4">
                  <div class="flex items-center gap-2.5">
                    <div class={`w-2 h-2 rounded-full shrink-0 ${runStatus().dot}`} />
                    <div>
                      <p class="text-sm font-semibold text-neutral-100">{runDetail()!.workflowKey}</p>
                      <p class="text-[11px] text-neutral-500 font-mono">{runDetail()!.traceId}</p>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 gap-2">
                    <div class="rounded-xl border border-neutral-800/70 bg-neutral-950/50 px-3 py-2.5">
                      <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">Timing</p>
                      <div class="mt-2 space-y-1.5 text-xs text-neutral-300">
                        <p>Started: {formatDateTime(runDetail()!.timing?.startedAt)}</p>
                        <p>Finished: {formatDateTime(runDetail()!.timing?.finishedAt)}</p>
                        <p>Duration: {formatDuration(runDetail()!.timing?.durationMs)}</p>
                      </div>
                    </div>

                    <Show when={runDetail()!.input && Object.keys(runDetail()!.input || {}).length > 0}>
                      <div class="space-y-2">
                        <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">Input</p>
                        <pre class="text-xs text-neutral-300 bg-neutral-950/70 border border-neutral-800/70 rounded-xl p-3 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                          {JSON.stringify(runDetail()!.input, null, 2)}
                        </pre>
                      </div>
                    </Show>

                    <Show when={runDetail()!.output}>
                      <div class="space-y-2">
                        <p class="text-[10px] uppercase tracking-[0.14em] text-emerald-400 font-semibold">Response Data</p>
                        <pre class="text-xs text-neutral-200 bg-neutral-950/70 border border-emerald-500/20 rounded-xl p-3 overflow-x-auto max-h-56 whitespace-pre-wrap break-all">
                          {JSON.stringify(runDetail()!.output, null, 2)}
                        </pre>
                      </div>
                    </Show>

                    <Show when={runDetail()!.error}>
                      <div class="space-y-2">
                        <p class="text-[10px] uppercase tracking-[0.14em] text-red-400 font-semibold">Error</p>
                        <pre class="text-xs text-red-300 bg-red-500/5 border border-red-500/20 rounded-xl p-3 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                          {JSON.stringify(runDetail()!.error, null, 2)}
                        </pre>
                      </div>
                    </Show>
                  </div>
                </div>

                <Show when={runDetail()!.workflowId}>
                  <Button variant="ghost" size="sm" class="w-full border border-neutral-800/70 bg-neutral-900/40 hover:bg-neutral-800/60" onClick={openWorkflowRoute}>
                    Open workflow page
                  </Button>
                </Show>
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      <Show when={props.notification.type === "approval_request"}>
        <div class="space-y-3">
          <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Action</p>
          <div class="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-4">
            <p class="text-sm text-neutral-300 leading-relaxed">
              This notification represents a workflow step waiting for approval. Use the approvals queue to inspect and respond.
            </p>
            <Button variant="ghost" size="sm" class="mt-4 w-full border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" onClick={openApprovals}>
              Open approvals
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}
