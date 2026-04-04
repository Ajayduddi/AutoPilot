import { For, Show, createSignal } from "solid-js";
import { TaskCard } from "./TaskCard";
import { WorkflowCard } from "./WorkflowCard";
import { SummaryBlock } from "./SummaryBlock";
import { ActionRow } from "./ActionRow";
import { SectionHeader } from "./SectionHeader";
import { MarkdownContent } from "./MarkdownContent";
import { StreamingCursor } from "./StreamingCursor";
import { SourceBlockView } from "./blocks/SourceBlockView";
import { EmailDraftBlockView } from "./blocks/EmailDraftBlockView";
import { QuestionMcqView } from "./blocks/QuestionMcqView";
import type {
  ActionItem, AssistantBlock, TaskCardBlock, WorkflowStatusBlock,
  DetailToggleBlock, TimelineBlock, ApprovalCardBlock,
} from "./types";

/**
 * Interface describing block renderer props shape.
 */
interface BlockRendererProps {
  blocks: AssistantBlock[];
  messageId?: string;
  streamingBlockIdx?: number;
  onTaskOpen?: (block: TaskCardBlock) => void;
  onWorkflowOpen?: (block: WorkflowStatusBlock) => void;
  onAction?: (action: ActionItem) => void | Promise<void>;
  onQuestionAnswer?: (payload: { messageId?: string; questionId: string; optionId?: string; valueToSend: string }) => void | Promise<void>;
}
const timelineStatusDot: Record<string, string> = {
  done: "bg-emerald-500",
  active: "bg-blue-500 animate-pulse",
  failed: "bg-red-500",
  pending: "bg-neutral-600",
};

/**
 * Utility function to timeline view.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for TimelineView.
 * @returns Return value from TimelineView.
 *
 * @example
 * ```typescript
 * const output = TimelineView(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function TimelineView(props: { block: TimelineBlock }) {
  return (
    <section class="block-enter space-y-0">
      <Show when={props.block.title}>
        <SectionHeader title={props.block.title!} divider />
      </Show>
      <div class="flex flex-col gap-0 mt-2">
        <For each={props.block.events}>
          {(ev, i) => (
            <div class="flex items-start gap-3 group/tl">
              <div class="flex flex-col items-center shrink-0 mt-1">
                <div class={`w-2 h-2 rounded-full shrink-0 ${timelineStatusDot[ev.status ?? "pending"]}`} />
                <Show when={i() < props.block.events.length - 1}>
                  <div class="w-px flex-1 min-h-[1.5rem] bg-neutral-800 mt-1" />
                </Show>
              </div>
              <div class="pb-3 min-w-0">
                <p class="text-sm text-neutral-200 leading-snug">{ev.label}</p>
                <Show when={ev.timestamp}>
                  <p class="text-[10px] text-neutral-600 mt-0.5 font-mono">{ev.timestamp}</p>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

/**
 * Utility function to detail toggle view.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from DetailToggleView.
 *
 * @example
 * ```typescript
 * const output = DetailToggleView();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function DetailToggleView(props: {
  block: DetailToggleBlock;
  messageId?: string;
  streamingBlockIdx?: number;
  onTaskOpen?: BlockRendererProps["onTaskOpen"];
  onWorkflowOpen?: BlockRendererProps["onWorkflowOpen"];
  onAction?: BlockRendererProps["onAction"];
  onQuestionAnswer?: BlockRendererProps["onQuestionAnswer"];
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <section class="block-enter rounded-xl border border-neutral-800/50 overflow-hidden bg-neutral-900/20">
      <button
        onClick={() => setOpen((v) => !v)}
        class="w-full flex items-center justify-between px-3.5 py-2 text-xs text-neutral-300 hover:bg-neutral-800/30 transition-colors"
      >
        <span class="font-medium">{props.block.summary}</span>
        <svg
          class={`w-3.5 h-3.5 text-neutral-500 transition-transform duration-200 ${open() ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="px-3.5 pb-3 pt-1 border-t border-neutral-800/50">
          <BlockRenderer
            blocks={props.block.children}
            messageId={props.messageId}
            streamingBlockIdx={props.streamingBlockIdx}
            onTaskOpen={props.onTaskOpen}
            onWorkflowOpen={props.onWorkflowOpen}
            onAction={props.onAction}
            onQuestionAnswer={props.onQuestionAnswer}
          />
        </div>
      </Show>
    </section>
  );
}

/**
 * Utility function to approval card view.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for ApprovalCardView.
 * @returns Return value from ApprovalCardView.
 *
 * @example
 * ```typescript
 * const output = ApprovalCardView(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function ApprovalCardView(props: { block: ApprovalCardBlock; onAction?: BlockRendererProps["onAction"] }) {
  const statusConfig = {
    pending: { pill: "text-amber-400 bg-amber-500/10 border-amber-500/20", label: "Pending Approval" },
    approved: { pill: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", label: "Approved" },
    rejected: { pill: "text-red-400 bg-red-500/10 border-red-500/20", label: "Rejected" },
  };
  const cfg = () => statusConfig[props.block.status];

  return (
    <section class="block-enter rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span class="text-sm font-semibold text-neutral-100">{props.block.title || "Approval Required"}</span>
        </div>
        <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${cfg().pill}`}>
          {cfg().label}
        </span>
      </div>
      <p class="text-sm text-neutral-300 leading-relaxed">{props.block.summary}</p>
      <Show when={props.block.details && Object.keys(props.block.details).length > 0}>
        <div class="space-y-1">
          <For each={Object.entries(props.block.details!)}>
            {([k, v]) => (
              <div class="flex gap-2 text-xs">
                <span class="text-neutral-500 capitalize min-w-[90px]">{k.replace(/_/g, " ")}</span>
                <span class="text-neutral-300">{v}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.block.status === "pending"}>
        <div class="flex gap-2 pt-1">
          <Show when={props.block.approveActionId}>
            <button
              onClick={() => props.onAction?.({ id: props.block.approveActionId!, label: "Approve", variant: "primary", entityId: props.block.approvalId })}
              class="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors"
            >Approve</button>
          </Show>
          <Show when={props.block.rejectActionId}>
            <button
              onClick={() => props.onAction?.({ id: props.block.rejectActionId!, label: "Reject", variant: "danger", entityId: props.block.approvalId })}
              class="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-600/15 text-red-300 border border-red-500/25 hover:bg-red-600/25 transition-colors"
            >Reject</button>
          </Show>
        </div>
      </Show>
    </section>
  );
}

/**
 * Utility function to block renderer.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for BlockRenderer.
 * @returns Return value from BlockRenderer.
 *
 * @example
 * ```typescript
 * const output = BlockRenderer(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function BlockRenderer(props: BlockRendererProps) {
  const isStreamingBlock = (idx: number) =>
    props.streamingBlockIdx !== undefined && props.streamingBlockIdx === idx;

  return (
    <div class="flex flex-col gap-3.5">
      <For each={props.blocks}>
        {(block, i) => {
          const streaming = () => isStreamingBlock(i());

          switch (block.type) {
            case "summary":
              return <div class="block-enter"><SummaryBlock title={block.title} items={block.items} /></div>;

            case "markdown":
              return (
                <section class="block-enter space-y-1.5">
                  <Show when={block.title}>
                    <SectionHeader title={block.title!} divider />
                  </Show>
                  <div class="text-[1em] text-neutral-100 leading-[1.9] break-words">
                    <MarkdownContent content={block.text} />
                    <Show when={streaming()}><StreamingCursor /></Show>
                  </div>
                </section>
              );

            case "text":
              return (
                <section class="block-enter space-y-1.5">
                  <Show when={block.title}>
                    <SectionHeader title={block.title!} divider />
                  </Show>
                  <p class="text-[1em] text-neutral-100 leading-[1.9] break-words whitespace-pre-wrap">
                    {block.text}
                    <Show when={streaming()}><StreamingCursor /></Show>
                  </p>
                </section>
              );

            case "result":
              return (
                <section class="block-enter rounded-xl bg-neutral-900/60 border border-neutral-800/70 px-4 py-3">
                  <SectionHeader title={block.title || "Results"} divider />
                  <ul class="mt-2 space-y-1.5 text-sm text-neutral-200">
                    <For each={block.items}>
                      {(item) => (
                        <li class="flex gap-2 items-start">
                          <span class="mt-[5px] h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                          {item}
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              );

            case "source": {
              const debugKeys = new Set([
                "answerMode", "routeKind", "contextScope", "contextsUsed",
                "workflowsUsed", "contextPass", "evidenceExpanded", "modelTier",
                "dataAgeSeconds", "rerunPromptPending", "selectedProvider",
                "selectedModel", "model", "autoMode", "failoverCount", "attempted",
                "planId", "planStepId", "selectedSubagent", "riskEvaluation",
              ]);
              const userMetadata = (block.metadata || []).filter((item: string) => {
                const key = String(item).split(":")[0]?.trim() || "";
                const normalizedKey = key.toLowerCase();
                if (debugKeys.has(key)) return false;
                if (normalizedKey.startsWith("react")) return false;
                if (normalizedKey.startsWith("plan")) return false;
                if (normalizedKey.startsWith("step")) return false;
                return true;
              });
              const hasDebugMeta = (block.metadata || []).length > userMetadata.length;
              return (
                <SourceBlockView
                  origin={block.origin}
                  actor={block.actor}
                  title={block.title}
                  userMetadata={userMetadata}
                  debugMetadata={hasDebugMeta ? (block.metadata || []) : []}
                />
              );
            }

            case "actions":
              return (
                <section class="block-enter space-y-2 pt-0.5">
                  <Show when={block.title}>
                    <SectionHeader title={block.title!} divider />
                  </Show>
                  <ActionRow items={block.items} onAction={props.onAction} />
                </section>
              );

            case "task_card":
              return (
                <div class="block-enter">
                  <TaskCard
                    title={block.task.title}
                    status={block.task.status}
                    source={block.task.source}
                    dueDate={block.task.dueDate}
                    description={block.task.description}
                    onOpenPanel={() => props.onTaskOpen?.(block)}
                  />
                </div>
              );

            case "workflow_status":
              return (
                <div class="block-enter">
                  <WorkflowCard
                    name={block.workflow.name}
                    status={block.workflow.status}
                    runId={block.workflow.runId}
                    startedAt={block.workflow.startedAt}
                    completedAt={block.workflow.completedAt}
                    timeline={block.workflow.timeline}
                    onViewDetails={() => props.onWorkflowOpen?.(block)}
                  />
                </div>
              );

            case "thinking":
              return (
                <section class="block-enter flex items-center gap-2.5 py-1">
                  <div class="flex gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
                    <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
                    <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
                  </div>
                  <span class="text-sm text-neutral-400">{block.label || "Thinking…"}</span>
                </section>
              );

            case "email_draft":
              return (
                <EmailDraftBlockView
                  subject={block.subject}
                  body={block.body}
                  intro={(block as { intro?: string }).intro}
                  outro={(block as { outro?: string }).outro}
                  signature={(block as { signature?: string[] }).signature}
                  onAction={props.onAction}
                />
              );

            case "error":
              return (
                <section class="block-enter rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-start gap-3">
                  <svg class="w-4 h-4 text-red-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <div>
                    <Show when={block.title}>
                      <p class="text-sm font-medium text-red-300 mb-0.5">{block.title}</p>
                    </Show>
                    <p class="text-sm text-neutral-300">{block.message}</p>
                    <Show when={block.code}>
                      <p class="text-xs text-neutral-500 font-mono mt-1">{block.code}</p>
                    </Show>
                  </div>
                </section>
              );

            case "timeline":
              return <TimelineView block={block} />;

            case "detail_toggle":
              return (
                <DetailToggleView
                  block={block}
                  messageId={props.messageId}
                  streamingBlockIdx={props.streamingBlockIdx}
                  onTaskOpen={props.onTaskOpen}
                  onWorkflowOpen={props.onWorkflowOpen}
                  onAction={props.onAction}
                  onQuestionAnswer={props.onQuestionAnswer}
                />
              );

            case "approval_card":
              return <ApprovalCardView block={block} onAction={props.onAction} />;

            case "question_mcq": {
              const previousBlock = i() > 0 ? props.blocks[i() - 1] : null;
              const previousSuggestsContinue = (() => {
                if (!previousBlock || (previousBlock.type !== "markdown" && previousBlock.type !== "text")) return false;
                const prevText = String((previousBlock as any).text || "").toLowerCase();
                return /\b(would you like|do you want|shall i|i can proceed|continue)\b/.test(prevText);
              })();
              return (
                <QuestionMcqView
                  messageId={props.messageId}
                  block={block}
                  compactProceedPrompt={previousSuggestsContinue}
                  onTaskOpen={props.onTaskOpen}
                  onWorkflowOpen={props.onWorkflowOpen}
                  onAction={props.onAction}
                  onQuestionAnswer={props.onQuestionAnswer}
                  renderContinuation={() =>
                    Array.isArray(block.continuation) && block.continuation.length > 0 ? (
                      <BlockRenderer
                        blocks={block.continuation}
                        messageId={props.messageId}
                        streamingBlockIdx={props.streamingBlockIdx}
                        onTaskOpen={props.onTaskOpen}
                        onWorkflowOpen={props.onWorkflowOpen}
                        onAction={props.onAction}
                        onQuestionAnswer={props.onQuestionAnswer}
                      />
                    ) : (
                      <></>
                    )
                  }
                />
              );
            }

            default: {
              const unknown = block as any;
              if (unknown?.text) {
                return (
                  <p class="block-enter text-sm text-neutral-400 italic leading-relaxed">
                    {unknown.text}
                  </p>
                );
              }
              return null;
            }
          }
        }}
      </For>
    </div>
  );
}
