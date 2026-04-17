/**
 * @fileoverview apps/frontend/src/components/chat/MemoryInsightsPanel.tsx
 *
 * High-level purpose:
 * Reusable frontend presentation module for rendering chat, settings, and UI primitives across routes.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Encapsulates reusable UI logic behind typed component contracts.
 * - Supports composable view patterns with minimal route coupling.
 * - Balances readability and flexibility for evolving product surfaces.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import the component into route or parent composition layers.
 * 2. Pass required typed props and wire callbacks to domain actions.
 * 3. Confirm visual and interaction behavior with component tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import type { ThreadMemoryInsightDto } from "@autopilot/shared";
import { chatApi } from "../../lib/api";

type MemoryInsightsPanelProps = {
  threadId: string;
};

const MEMORY_CATEGORY_FILTERS: Array<{ value: ThreadMemoryInsightDto["category"] | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "chat_summary", label: "Summaries" },
  { value: "thread_state", label: "Thread state" },
  { value: "workflow_run", label: "Workflow runs" },
  { value: "assistant_decision", label: "Decisions" },
  { value: "audit_event", label: "Audit" },
];

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function categoryLabel(category: ThreadMemoryInsightDto["category"]) {
  switch (category) {
    case "chat_summary":
      return "Chat Summary";
    case "thread_state":
      return "Thread State";
    case "workflow_run":
      return "Workflow Run";
    case "assistant_decision":
      return "Assistant Decision";
    case "audit_event":
      return "Audit Event";
    default:
      return category;
  }
}

function importanceTone(importance?: string) {
  switch ((importance || "").toLowerCase()) {
    case "high":
      return "text-amber-300 border-amber-500/20 bg-amber-500/10";
    case "medium":
      return "text-sky-300 border-sky-500/20 bg-sky-500/10";
    default:
      return "text-neutral-300 border-neutral-700/70 bg-neutral-800/70";
  }
}

export function MemoryInsightsPanel(props: MemoryInsightsPanelProps) {
  const [selectedCategory, setSelectedCategory] = createSignal<ThreadMemoryInsightDto["category"] | "all">("all");
  const [resultLimit, setResultLimit] = createSignal(40);
  const [memoryInsightsResponse] = createResource(
    () => ({ threadId: props.threadId, category: selectedCategory(), limit: resultLimit() }),
    ({ threadId, category, limit }) => chatApi.getThreadMemoryInsightsEnvelope(threadId, {
      category,
      limit,
      groupBy: category === "all" ? "category" : "none",
    }),
  );
  const memoryInsights = createMemo(() => memoryInsightsResponse()?.data || []);
  const groupedCounts = createMemo(() => memoryInsightsResponse()?.meta?.groupedCounts || {
    workflow_run: 0,
    assistant_decision: 0,
    thread_state: 0,
    audit_event: 0,
    chat_summary: 0,
  });

  const insightCountLabel = createMemo(() => {
    const total = memoryInsightsResponse()?.meta?.total ?? memoryInsights().length;
    return `${total} ${total === 1 ? "memory item" : "memory items"}`;
  });

  const shouldShowSectionLabel = (items: ThreadMemoryInsightDto[], index: number) => {
    if (selectedCategory() !== "all") return false;
    if (index === 0) return true;
    return items[index - 1]?.category !== items[index]?.category;
  };

  return (
    <div class="space-y-5">
      <div>
        <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Thread Memory</p>
        <h3 class="mt-2 text-base font-semibold text-neutral-100">Saved thread context</h3>
        <p class="mt-2 text-sm text-neutral-400 leading-relaxed">
          This is the durable memory the assistant can reuse across the thread. Exact thread state stays primary, and semantic summaries help with longer-term recall.
        </p>
        <Show when={insightCountLabel()}>
          <p class="mt-2 text-xs text-neutral-500">{insightCountLabel()}</p>
        </Show>
      </div>

      <div class="space-y-3">
        <div class="flex flex-wrap gap-2">
          <For each={MEMORY_CATEGORY_FILTERS}>
            {(filter) => (
              <button
                onClick={() => {
                  setSelectedCategory(filter.value);
                  setResultLimit(40);
                }}
                class={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-all duration-150 ${
                  selectedCategory() === filter.value
                    ? "border-indigo-500/30 bg-indigo-500/15 text-indigo-200"
                    : "border-neutral-800/70 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700/70 hover:text-neutral-200"
                }`}
              >
                {filter.label}
                <Show when={filter.value !== "all"}>
                  <span class="ml-1.5 text-[10px] text-neutral-400">
                    {groupedCounts()[filter.value as ThreadMemoryInsightDto["category"]]}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
        <p class="text-xs text-neutral-500">
          Filter memory by source type. Large threads load a bounded window first to keep this panel fast.
        </p>
      </div>

      <Show when={!memoryInsightsResponse.loading} fallback={
        <div class="space-y-3">
          <For each={[1, 2, 3]}>
            {() => <div class="h-28 rounded-2xl border border-neutral-800/70 bg-neutral-900/60 animate-pulse" />}
          </For>
        </div>
      }>
        <Show when={!memoryInsightsResponse.error} fallback={
          <div class="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-4">
            <p class="text-sm font-medium text-red-300">Could not load memory insights.</p>
            <p class="mt-1 text-xs text-red-200/80">The thread is still usable; this panel is only for visibility and debugging.</p>
          </div>
        }>
          <Show when={memoryInsights().length > 0} fallback={
            <div class="rounded-2xl border border-neutral-800/70 bg-neutral-900/50 px-4 py-4">
              <p class="text-sm font-medium text-neutral-200">No saved thread memory yet.</p>
              <p class="mt-1 text-xs text-neutral-500">Once the assistant stores summaries, decisions, or workflow outcomes, they’ll appear here.</p>
            </div>
          }>
            <div class="space-y-3">
              <For each={memoryInsights()}>
                {(item, index) => (
                  <>
                    <Show when={shouldShowSectionLabel(memoryInsights(), index())}>
                      <div class="pt-1">
                        <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                          {categoryLabel(item.category)}
                        </p>
                      </div>
                    </Show>
                    <article class="rounded-2xl border border-neutral-800/70 bg-neutral-900/60 px-4 py-4">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="rounded-full border border-neutral-700/70 bg-neutral-800/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-300">
                          {categoryLabel(item.category)}
                        </span>
                        <Show when={item.summaryKind}>
                          <span class="rounded-full border border-neutral-700/70 bg-neutral-800/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
                            {String(item.summaryKind).replace(/_/g, " ")}
                          </span>
                        </Show>
                        <Show when={item.importance}>
                          <span class={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${importanceTone(item.importance)}`}>
                            {item.importance}
                          </span>
                        </Show>
                        <span class={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${item.hasEmbedding
                          ? "text-emerald-300 border-emerald-500/20 bg-emerald-500/10"
                          : "text-neutral-400 border-neutral-700/70 bg-neutral-800/70"}`}>
                          {item.hasEmbedding ? "Embedded" : "Exact only"}
                        </span>
                      </div>

                      <Show when={item.summary}>
                        <h4 class="mt-3 text-sm font-medium text-neutral-100 leading-relaxed">{item.summary}</h4>
                      </Show>

                      <p class="mt-3 text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap break-words">
                        {item.contentPreview}
                      </p>

                      <Show when={item.entityKeys.length > 0}>
                        <div class="mt-3 flex flex-wrap gap-2">
                          <For each={item.entityKeys}>
                            {(entityKey) => (
                              <span class="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-200">
                                {entityKey}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>

                      <p class="mt-3 text-xs text-neutral-500">
                        Saved {formatTimestamp(item.createdAt)}
                      </p>
                    </article>
                  </>
                )}
              </For>
            </div>
            <Show when={memoryInsights().length >= resultLimit() && (memoryInsightsResponse()?.meta?.total || 0) > memoryInsights().length}>
              <button
                onClick={() => setResultLimit((value) => Math.min(value + 40, 200))}
                class="w-full rounded-2xl border border-neutral-800/70 bg-neutral-900/60 px-4 py-3 text-sm font-medium text-neutral-300 hover:text-neutral-100 hover:border-neutral-700/70 transition-all duration-150"
              >
                Load more memory
              </button>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
