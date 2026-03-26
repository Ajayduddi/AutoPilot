import { Title } from "@solidjs/meta";
import { createResource, createSignal, For, Show } from "solid-js";
import { ApprovalCard } from "../components/chat/ApprovalCard";
import { approvalsApi } from "../lib/api";

export default function Approvals() {
  const [approvals, { refetch }] = createResource(() => approvalsApi.getPending());
  const [resolving, setResolving] = createSignal<string | null>(null);

  async function resolve(id: string, status: "approved" | "rejected") {
    setResolving(id);
    try {
      await approvalsApi.resolve(id, status);
      await refetch();
    } catch (e: any) {
      console.error("Resolve failed:", e.message);
    } finally {
      setResolving(null);
    }
  }

  const pendingCount = () => (approvals() || []).length;

  return (
    <>
      <Title>Approvals — AutoPilot</Title>
      <main class="flex-1 flex flex-col h-full bg-[#111111] min-w-0">
        <header class="px-6 py-4 border-b border-neutral-800/20 flex items-center justify-between shrink-0">
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-[14px] font-medium text-neutral-200">Pending Approvals</h1>
              <Show when={pendingCount() > 0}>
                <span class="text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  {pendingCount()} pending
                </span>
              </Show>
            </div>
            <p class="text-[12px] text-neutral-600 mt-0.5">Review and authorize sensitive workflow actions before they execute.</p>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto px-6 py-6">
          <div class="max-w-2xl mx-auto flex flex-col gap-4">
            <Show when={approvals.loading}>
              <div class="flex items-center gap-2 text-sm text-neutral-500">
                <div class="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                Loading approvals…
              </div>
            </Show>

            <Show when={!approvals.loading && pendingCount() === 0}>
              <div class="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-4 py-6 text-center">
                <p class="text-emerald-400 text-sm font-medium">✓ All clear</p>
                <p class="text-neutral-600 text-xs mt-1">No pending approvals right now.</p>
              </div>
            </Show>

            <Show when={!approvals.loading && pendingCount() > 0}>
              <div class="rounded-lg bg-amber-500/5 border border-amber-500/15 px-4 py-3 text-xs text-amber-400/80 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                Workflows are paused until you respond. Your decisions are logged.
              </div>
            </Show>

            <For each={approvals() || []}>
              {(appr: any) => (
                <ApprovalCard
                  id={appr.id}
                  summary={appr.summary}
                  workflowName={appr.runId}
                  riskLevel="medium"
                  onApprove={() => resolve(appr.id, "approved")}
                  onReject={() => resolve(appr.id, "rejected")}
                />
              )}
            </For>
          </div>
        </div>
      </main>
    </>
  );
}
