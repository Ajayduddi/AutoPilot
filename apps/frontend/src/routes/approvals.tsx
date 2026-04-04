import { Title } from "@solidjs/meta";
import { createResource, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { ApprovalCard } from "../components/chat/ApprovalCard";
import { ShieldCheckIcon } from "../components/ui/icons";
import { approvalsApi } from "../lib/api";
import { useMobileMenu } from "../context/mobile-menu.context";

export default function Approvals() {
  const [approvals, { refetch }] = createResource(() => approvalsApi.getPending());
  const [resolving, setResolving] = createSignal<string | null>(null);
  const [refreshing, setRefreshing] = createSignal(false);
  const mobileMenu = useMobileMenu();

  /**
   * Utility function to resolve.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param id - Input value for resolve.
   * @param status - Input value for resolve.
   * @returns Return value from resolve.
   *
   * @example
   * ```typescript
   * const output = resolve(value, value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
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

  /**
   * Utility function to refresh pending.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from refreshPending.
   *
   * @example
   * ```typescript
   * const output = refreshPending();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function refreshPending() {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }

  onMount(() => {
    const interval = window.setInterval(() => {
      refetch();
    }, 20000);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    onCleanup(() => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    });
  });

  return (
    <>
      <Title>Approvals — AutoPilot</Title>
      <main class="flex-1 flex flex-col h-full bg-[#111111] min-w-0">
        <header class="px-4 md:px-6 py-4 border-b border-neutral-800/20 shrink-0">
          <div class="max-w-5xl mx-auto flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div class="flex items-center gap-3">
              <button onClick={() => mobileMenu.toggle()} class="md:hidden p-2 -ml-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50 block">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
              </button>
              <div>
                <div class="flex items-center gap-2.5">
                  <h1 class="page-title">Pending Approvals</h1>
                  <span class="text-[10px] font-semibold bg-neutral-900/70 text-neutral-300 border border-neutral-800/70 px-2 py-0.5 rounded-full hidden sm:inline-block">
                    Queue
                  </span>
                </div>
                <p class="page-subtitle hidden sm:block">Review and authorize sensitive workflow actions before they execute.</p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <Show when={pendingCount() > 0}>
                <span class="text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  {pendingCount()} pending
                </span>
              </Show>
              <button
                onClick={refreshPending}
                disabled={refreshing()}
                class={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-200 ${
                  refreshing()
                    ? "border-neutral-800/60 text-neutral-600 cursor-not-allowed"
                    : "border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-900/70"
                }`}
              >
                {refreshing() ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto px-6 py-6">
          <div class="max-w-5xl mx-auto flex flex-col gap-4">
            <div class="rounded-xl border border-neutral-800/70 bg-neutral-950/65 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 flex items-center justify-center">
                  <ShieldCheckIcon class="w-[15px] h-[15px]" />
                </div>
                <div>
                  <p class="text-[12px] font-medium text-neutral-200">Guarded execution</p>
                  <p class="text-[11px] text-neutral-500">Every decision is audited and applied immediately.</p>
                </div>
              </div>
              <div class="text-[11px] text-neutral-400">
                {pendingCount() > 0 ? `${pendingCount()} waiting for review` : "No active approval items"}
              </div>
            </div>

            <Show when={approvals.loading}>
              <div class="grid grid-cols-1 gap-3">
                <For each={[1, 2, 3]}>
                  {() => (
                    <div class="rounded-2xl border border-neutral-800/70 bg-neutral-950/70 p-5 animate-pulse">
                      <div class="flex items-center gap-3">
                        <div class="h-9 w-9 rounded-xl bg-neutral-900/90" />
                        <div class="h-4 w-44 rounded bg-neutral-800/90" />
                      </div>
                      <div class="mt-4 h-4 w-full rounded bg-neutral-900/90" />
                      <div class="mt-2 h-4 w-4/5 rounded bg-neutral-900/90" />
                      <div class="mt-4 flex gap-2">
                        <div class="h-8 w-24 rounded-lg bg-neutral-900/90" />
                        <div class="h-8 w-24 rounded-lg bg-neutral-900/90" />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={!approvals.loading && pendingCount() === 0}>
              <div class="rounded-2xl border border-neutral-800/75 bg-[radial-gradient(120%_140%_at_50%_-10%,rgba(16,185,129,0.12),rgba(10,10,10,0.92))] p-10 text-center shadow-[0_22px_40px_rgba(0,0,0,0.32)]">
                <div class="w-16 h-16 mx-auto rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <ShieldCheckIcon class="w-6 h-6" />
                </div>
                <h2 class="mt-5 text-[18px] font-semibold tracking-tight text-neutral-100">No approvals waiting</h2>
                <p class="text-neutral-300 text-sm mt-1">Everything is currently authorized and flowing normally.</p>
                <p class="text-neutral-500 text-xs mt-2">New guarded steps from automated workflows will appear in this queue.</p>
                <div class="mt-6">
                  <button
                    onClick={refreshPending}
                    disabled={refreshing()}
                    class={`text-xs px-3.5 py-1.5 rounded-lg border transition-all duration-200 ${
                      refreshing()
                        ? "border-neutral-700/50 text-neutral-600 cursor-not-allowed"
                        : "border-neutral-700/80 bg-neutral-950/60 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-900/80"
                    }`}
                  >
                    {refreshing() ? "Refreshing..." : "Check again"}
                  </button>
                </div>
              </div>
            </Show>

            <Show when={!approvals.loading && pendingCount() > 0}>
              <div class="rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3 text-xs text-amber-300/85 flex items-center gap-2">
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
                  createdAt={appr.createdAt}
                  details={appr.details}
                  busy={resolving() === appr.id}
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
