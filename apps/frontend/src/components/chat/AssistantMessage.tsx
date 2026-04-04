import { Show, createSignal } from "solid-js";
import { BlockRenderer } from "./BlockRenderer";
import { MarkdownContent } from "./MarkdownContent";
import { StreamingCursor } from "./StreamingCursor";
import type { ActionItem, AssistantBlock, MessageState, TaskCardBlock, WorkflowStatusBlock } from "./types";

interface AssistantMessageProps {
  messageId?: string;
  content?: string;
  textScale?: number;
  blocks?: AssistantBlock[];
  state?: MessageState;
  /** Index of the block currently receiving streaming chunks */
  streamingBlockIdx?: number;
  onRetry?: () => void;
  onTaskOpen?: (block: TaskCardBlock) => void;
  onWorkflowOpen?: (block: WorkflowStatusBlock) => void;
  onAction?: (action: ActionItem) => void | Promise<void>;
  onQuestionAnswer?: (payload: { messageId?: string; questionId: string; optionId?: string; valueToSend: string }) => void | Promise<void>;
}

function IconCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconRetry() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.18" />
    </svg>
  );
}

function IconThumbUp() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

function IconThumbDown() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
      <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
    </svg>
  );
}

/** Pulsing dots shown during the thinking phase */
function ThinkingIndicator(props: { label?: string }) {
  return (
    <div class="flex items-center gap-2.5 py-1">
      <div class="flex gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
        <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
        <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
      </div>
      <span class="text-sm text-neutral-400">{props.label ?? "Thinking…"}</span>
    </div>
  );
}

export function AssistantMessage(props: AssistantMessageProps) {
  const [copied, setCopied] = createSignal(false);
  const [feedback, setFeedback] = createSignal<"up" | "down" | null>(null);

  const effectiveState = () => props.state ?? "completed";

  // Gather plain text for clipboard copy
  const plainText = (): string => {
    if (props.content) return props.content;
    return (props.blocks ?? [])
      .filter((b): b is any => b.type === "markdown" || b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n\n");
  };

  const copyText = () => {
    const text = plainText().trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const hasBlocks = () => (props.blocks?.length ?? 0) > 0;
  const bodyScaleStyle = () => {
    const scale = Math.min(130, Math.max(85, props.textScale ?? 100));
    return { "font-size": `calc(0.9375rem * ${scale} / 100)` };
  };

  return (
    <div class="assistant-message group/ai flex w-full max-w-none justify-start mb-1">
      <div class="w-full max-w-none flex flex-col items-stretch">

        {/* Identity row */}
        <div class="flex items-center gap-2 mb-3">
          <div class="w-5 h-5 rounded-md bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <span class="text-[10px] font-medium text-neutral-500 tracking-wide">AutoPilot</span>

          {/* State badge — only while in-flight */}
          <Show when={effectiveState() === "streaming"}>
            <span class="text-[10px] text-blue-400/70 flex items-center gap-1">
              <StreamingCursor />
              <span class="ml-1">Generating</span>
            </span>
          </Show>
          <Show when={effectiveState() === "retrying"}>
            <span class="text-[10px] text-amber-400/70">Retrying…</span>
          </Show>
        </div>

        {/* Body */}
        <div class="w-full max-w-none text-neutral-100 leading-[1.9] break-words min-h-[1.5rem]" style={bodyScaleStyle()}>
          <Show
            when={effectiveState() !== "thinking"}
            fallback={<ThinkingIndicator />}
          >
            <Show
              when={hasBlocks()}
              fallback={
                <Show when={props.content}>
                  <MarkdownContent content={props.content!} />
                  <Show when={effectiveState() === "streaming"}><StreamingCursor /></Show>
                </Show>
              }
            >
              <BlockRenderer
                blocks={props.blocks!}
                streamingBlockIdx={props.streamingBlockIdx ?? -1}
                onTaskOpen={props.onTaskOpen}
                onWorkflowOpen={props.onWorkflowOpen}
                onAction={props.onAction}
                onQuestionAnswer={props.onQuestionAnswer}
              />
            </Show>
          </Show>
        </div>

        {/* Action bar — visible on hover when message is settled */}
        <Show when={effectiveState() === "completed" || effectiveState() === "error"}>
          <div class="flex items-center gap-1 mt-3 -ml-1 opacity-0 group-hover/ai:opacity-100 transition-opacity duration-150">
            <button
              title={copied() ? "Copied" : "Copy response"}
              onClick={copyText}
              class={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150 ${
                copied() ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-100 hover:bg-white/5"
              }`}
            >
              <Show when={copied()} fallback={<IconCopy />}><IconCheck /></Show>
            </button>
            <Show when={props.onRetry}>
              <button
                title="Regenerate response"
                onClick={props.onRetry}
                class="flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150 text-neutral-500 hover:text-neutral-100 hover:bg-white/5"
              >
                <IconRetry />
              </button>
            </Show>

            {/* Divider */}
            <span class="w-px h-4 bg-neutral-700/50" />

            <button
              title="Good response"
              onClick={() => setFeedback(f => f === "up" ? null : "up")}
              class={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150 ${
                feedback() === "up"
                  ? "text-emerald-400 bg-emerald-500/10"
                  : "text-neutral-500 hover:text-emerald-400 hover:bg-white/5"
              }`}
            >
              <IconThumbUp />
            </button>
            <button
              title="Bad response"
              onClick={() => setFeedback(f => f === "down" ? null : "down")}
              class={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150 ${
                feedback() === "down"
                  ? "text-red-400 bg-red-500/10"
                  : "text-neutral-500 hover:text-red-400 hover:bg-white/5"
              }`}
            >
              <IconThumbDown />
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
