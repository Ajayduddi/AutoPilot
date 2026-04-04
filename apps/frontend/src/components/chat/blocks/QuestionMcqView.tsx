import { Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { QuestionMcqBlock, TaskCardBlock, WorkflowStatusBlock } from "../types";

/**
 * Props for rendering an interactive multiple-choice question block.
 */
interface QuestionMcqViewProps {
  messageId?: string;
  block: QuestionMcqBlock;
  compactProceedPrompt?: boolean;
  onTaskOpen?: (block: TaskCardBlock) => void;
  onWorkflowOpen?: (block: WorkflowStatusBlock) => void;
  onAction?: (action: any) => void | Promise<void>;
  onQuestionAnswer?: (payload: { messageId?: string; questionId: string; optionId?: string; valueToSend: string }) => void | Promise<void>;
  renderContinuation?: () => JSX.Element;
}

/**
 * Heuristic that detects proceed/continue style prompts for compact rendering.
 *
 * @param block - MCQ block payload.
 * @returns `true` when prompt/options look like workflow proceed confirmation.
 */
export function isWorkflowProceedPrompt(block: QuestionMcqBlock): boolean {
  const prompt = String(block.prompt || "").toLowerCase();
  const options = Array.isArray(block.options) ? block.options : [];
  const combined = options
    .map((opt) => `${String(opt.label || "")} ${String(opt.valueToSend || "")}`.toLowerCase())
    .join(" | ");
  const promptLooksLikeProceed =
    /\b(workflow|run|proceed|continue|action)\b/.test(prompt) &&
    /\b(choose|continue|proceed|run)\b/.test(prompt);
  const optionsLookLikeProceed =
    /\b(approve|run|proceed|yes)\b/.test(combined) &&
    /\b(not now|later|skip|cancel|no)\b/.test(combined);
  return promptLooksLikeProceed || optionsLookLikeProceed;
}

/**
 * Renders a question block with selectable options and submission state.
 *
 * @param props - Component props and interaction callbacks.
 * @returns SolidJS element tree for the question UI.
 */
export function QuestionMcqView(props: QuestionMcqViewProps) {
  const proceedPrompt = () => isWorkflowProceedPrompt(props.block);
  const [loadingOptionId, setLoadingOptionId] = createSignal<string | null>(null);
  const [localSelectedOptionId, setLocalSelectedOptionId] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(!props.block.collapsed && !proceedPrompt());
  const selectedOptionId = () => props.block.selectedOptionId || localSelectedOptionId();
  const isSubmitting = () => props.block.state === "submitting";
  const isAnswered = () => props.block.state === "answered" || !!selectedOptionId();
  const isCompact = () => isSubmitting() || isAnswered();
  const showPromptText = () => !(props.compactProceedPrompt && proceedPrompt());
  const selectedOptionLabel = () => props.block.options.find((o) => o.id === selectedOptionId())?.label || props.block.selectedValue || "";
  const submitOption = async (option: QuestionMcqBlock["options"][number]) => {
    if (props.block.stale || loadingOptionId() || selectedOptionId() || !props.onQuestionAnswer) return;
    setLoadingOptionId(option.id);
    try {
      await props.onQuestionAnswer({
        messageId: props.messageId,
        questionId: props.block.questionId,
        optionId: option.id,
        valueToSend: option.valueToSend,
      });
      setLocalSelectedOptionId(option.id);
      setExpanded(false);
    } finally {
      setLoadingOptionId(null);
    }
  };

  return (
    <div class="block-enter space-y-3">
      <section class="rounded-2xl border border-neutral-800/60 bg-neutral-950/75 overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          class={`w-full flex items-center justify-between gap-3 text-left hover:bg-neutral-900/40 transition-colors ${
            isCompact() ? "px-4 py-3" : "px-5 py-4 border-b border-neutral-800/60"
          }`}
        >
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-[0.12em] text-neutral-500 font-semibold">
              {isCompact() ? "Summary" : proceedPrompt() ? "Optional action" : "Question"}
            </p>
            <Show when={showPromptText()}>
              <p class="text-sm text-neutral-100 mt-1 truncate">{props.block.prompt}</p>
            </Show>
            <Show when={!showPromptText()}>
              <p class="text-xs text-neutral-400 mt-1">Choose how you want to continue.</p>
            </Show>
            <Show when={selectedOptionId()}>
              <p class="text-xs text-neutral-400 mt-1.5">
                Selected: <span class="text-neutral-200">{selectedOptionLabel()}</span>
              </p>
            </Show>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Show when={props.block.stale}>
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-neutral-700 text-neutral-400 bg-neutral-800/60">
                Expired
              </span>
            </Show>
            <Show when={isSubmitting() && !props.block.stale}>
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-blue-500/35 text-blue-300 bg-blue-500/10">
                Thinking
              </span>
            </Show>
            <Show when={isAnswered() && !isSubmitting() && !props.block.stale}>
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-emerald-500/35 text-emerald-300 bg-emerald-500/10">
                Answered
              </span>
            </Show>
            <svg
              class={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${expanded() ? "rotate-180" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>

        <Show when={expanded() && !isCompact()}>
          <div class={`space-y-2 ${proceedPrompt() ? "px-4 py-3" : "px-5 py-4"}`}>
            {props.block.options.map((option) => {
              const isLoading = () => loadingOptionId() === option.id;
              const isSelected = () => selectedOptionId() === option.id;
              const isDisabled = () => !!loadingOptionId() || !!selectedOptionId() || !!props.block.stale;
              return (
                <button
                  onClick={() => submitOption(option)}
                  disabled={isDisabled()}
                  class={`w-full text-left rounded-xl border min-h-[48px] transition-all duration-150 ${
                    proceedPrompt() ? "px-3.5 py-3" : "px-4 py-3.5"
                  } ${
                    isSelected()
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/60"
                  } ${isDisabled() ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class={`text-sm ${isSelected() ? "text-emerald-200" : "text-neutral-200"}`}>{option.label}</p>
                      <Show when={option.description}>
                        <p class="text-xs text-neutral-500 mt-0.5">{option.description}</p>
                      </Show>
                    </div>
                    <Show when={option.recommended}>
                      <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-blue-500/30 text-blue-300 bg-blue-500/10 shrink-0">
                        Recommended
                      </span>
                    </Show>
                  </div>
                  <Show when={isLoading()}>
                    <p class="text-[11px] text-neutral-500 mt-1.5">Submitting...</p>
                  </Show>
                </button>
              );
            })}
          </div>
        </Show>
      </section>

      <Show when={isSubmitting()}>
        <section class="rounded-2xl border border-neutral-800/60 bg-neutral-950/75 px-4 py-3.5">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="w-2 h-2 rounded-full bg-blue-400/90 animate-bounce [animation-delay:-0.2s]" />
              <span class="w-2 h-2 rounded-full bg-blue-400/80 animate-bounce [animation-delay:-0.1s]" />
              <span class="w-2 h-2 rounded-full bg-blue-400/70 animate-bounce" />
            </div>
            <div class="min-w-0">
              <p class="text-sm text-neutral-200">Thinking through the follow-up...</p>
              <p class="text-xs text-neutral-500 mt-1">Running the selected action and preparing the answer.</p>
            </div>
          </div>
        </section>
      </Show>

      <Show when={props.renderContinuation}>
        {props.renderContinuation!()}
      </Show>
    </div>
  );
}
