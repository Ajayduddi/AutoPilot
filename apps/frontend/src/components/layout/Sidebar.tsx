/**
 * @fileoverview apps/frontend/src/components/layout/Sidebar.tsx
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
import { A, useLocation, useNavigate } from "@solidjs/router";
import { createSignal, createResource, createEffect, Show, For, onMount, onCleanup } from "solid-js";
import { useNotifications } from "../../context/notifications.context";
import { approvalsApi, chatApi } from "../../lib/api";
import { useAuth } from "../../context/auth.context";
import { useMobileMenu } from "../../context/mobile-menu.context";
import { Portal } from "solid-js/web";

/**
 * Utility function to sidebar.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from Sidebar.
 *
 * @example
 * ```typescript
 * const output = Sidebar();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function Sidebar() {
  const [expanded, setExpanded] = createSignal(false);
  const { unreadCount } = useNotifications();
  const auth = useAuth();
  const location = useLocation();
  const [pendingApprovals, setPendingApprovals] = createSignal(0);
  const mobileMenu = useMobileMenu();
  const navigate = useNavigate();

  // Mobile thread menu state
  const [menuOpenId, setMenuOpenId] = createSignal<string | null>(null);
  const [editingThreadId, setEditingThreadId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [menuAnchor, setMenuAnchor] = createSignal<{ top: number; right: number } | null>(null);

  // Fetch threads for mobile sidebar
  const [threads, { refetch: refetchThreads }] = createResource(
    () => mobileMenu.isOpen(),
    async (isOpen) => {
      if (!isOpen) return [];
      try { return await chatApi.getThreads(); } catch { return []; }
    }
  );

  async function commitRename(threadId: string) {
    const title = renameValue().trim();
    if (!title) { setEditingThreadId(null); return; }
    try { await chatApi.renameThread(threadId, title); } catch { /* keep going */ }
    setEditingThreadId(null);
    refetchThreads();
  }

  async function deleteThread(threadId: string) {
    try { await chatApi.deleteThread(threadId); } catch { /* keep going */ }
    setMenuOpenId(null);
    refetchThreads();
  }

  function openThreadMenu(e: MouseEvent, threadId: string) {
    e.stopPropagation();
    if (menuOpenId() === threadId) { setMenuOpenId(null); setMenuAnchor(null); return; }
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    // Set in next tick so the document click handler (which fires on same event) doesn't close it
    setTimeout(() => setMenuOpenId(threadId), 0);
  }

  function closeMenu() { setMenuOpenId(null); setMenuAnchor(null); }

  // Attach outside-click handler only while a menu is open
  createEffect(() => {
    if (menuOpenId() !== null) {
      const handler = () => closeMenu();
      document.addEventListener("click", handler);
      onCleanup(() => document.removeEventListener("click", handler));
    }
  });
  const isActuallyExpanded = () => expanded() || mobileMenu.isOpen();
  const labelClass = () => `text-[14px] font-medium whitespace-nowrap transition-[opacity,max-width] duration-300 overflow-hidden ${isActuallyExpanded() ? "opacity-100 max-w-[140px]" : "opacity-0 max-w-0"}`;
  const unreadLabel = () => (unreadCount() > 9 ? "9+" : String(unreadCount()));
  const approvalsLabel = () => (pendingApprovals() > 9 ? "9+" : String(pendingApprovals()));
  const showApprovalsNav = () => pendingApprovals() > 0 || location.pathname.startsWith("/approvals");

  /**
   * Utility function to refresh pending approvals.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from refreshPendingApprovals.
   *
   * @example
   * ```typescript
   * const output = refreshPendingApprovals();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function refreshPendingApprovals() {
    try {
      const items = await approvalsApi.getPending();
      setPendingApprovals((items || []).length);
    } catch {
      // Keep sidebar stable if endpoint temporarily fails.
      setPendingApprovals(0);
    }
  }

  onMount(() => {
    refreshPendingApprovals();
    const interval = window.setInterval(refreshPendingApprovals, 20000);
    const onFocus = () => refreshPendingApprovals();
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
      <Show when={mobileMenu.isOpen()}>
        <div 
          class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden transition-opacity"
          onClick={() => mobileMenu.close()}
        />
      </Show>

      <aside
        class={`fixed md:relative inset-y-0 left-0 z-50 border-r border-[#1a1a1a] bg-[#0a0a0a] flex flex-col shrink-0 overflow-x-hidden overflow-y-auto scrollbar-custom transition-[width,transform] duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          mobileMenu.isOpen() ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
        style={{ width: mobileMenu.isOpen() ? "100vw" : isActuallyExpanded() ? "220px" : "60px" }}
      >
        {/* Brand */}
        <button
          onClick={() => { mobileMenu.close(); navigate("/"); }}
          class={`py-5 flex items-center w-full text-left cursor-pointer ${mobileMenu.isOpen() ? "justify-center gap-3" : isActuallyExpanded() ? "px-5 gap-3" : "justify-center"}`}
          style={{ transition: "padding 400ms cubic-bezier(0.4, 0, 0.2, 1)" }}
          title="New chat"
        >
        <div class="w-9 h-9 rounded-xl bg-indigo-600/95 flex items-center justify-center shadow-[0_0_22px_rgba(99,102,241,0.38)] border border-indigo-400/20 shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
        </div>
        <span class={`text-[15px] font-semibold text-neutral-50 tracking-tight ${mobileMenu.isOpen() ? "opacity-100 max-w-none" : labelClass()}`}>AutoPilot</span>
        </button>

      {/* Nav */}
      <nav class={`shrink-0 flex flex-col gap-1 pt-2 ${isActuallyExpanded() ? "px-2.5" : "items-center"}`} style={{ transition: "padding 400ms cubic-bezier(0.4, 0, 0.2, 1)" }}>
        <A onClick={() => mobileMenu.close()} href="/" end class={`flex items-center rounded-xl text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-all duration-200 ${isActuallyExpanded() ? "gap-3 px-3 py-2.5" : "w-10 h-10 mx-auto justify-center"}`} activeClass="!bg-neutral-800/80 !text-neutral-100" title="Chat">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span class={labelClass()}>Chat</span>
        </A>

        <A onClick={() => mobileMenu.close()} href="/workflows" class={`flex items-center rounded-xl text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-all duration-200 ${isActuallyExpanded() ? "gap-3 px-3 py-2.5" : "w-10 h-10 mx-auto justify-center"}`} activeClass="!bg-neutral-800/80 !text-neutral-100" title="Workflows">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          <span class={labelClass()}>Workflows</span>
        </A>

        <A onClick={() => mobileMenu.close()} href="/notifications" class={`relative flex items-center rounded-xl text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-all duration-200 ${isActuallyExpanded() ? "gap-3 px-3 py-2.5" : "w-10 h-10 mx-auto justify-center"}`} activeClass="!bg-neutral-800/80 !text-neutral-100" title="Notifications">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          <span class={`${labelClass()} flex-1`}>Notifications</span>
          <Show when={unreadCount() > 0}>
            <span class={`transition-all duration-300 ${isActuallyExpanded() ? "text-[9px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full opacity-100" : "absolute top-1 right-1 min-w-[14px] h-3.5 bg-blue-500 text-[8px] font-bold text-white rounded-full flex items-center justify-center opacity-100 px-1"}`}>
              {unreadLabel()}
            </span>
          </Show>
        </A>

        <Show when={showApprovalsNav()}>
          <A onClick={() => mobileMenu.close()} href="/approvals" class={`relative flex items-center rounded-xl text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-all duration-200 ${isActuallyExpanded() ? "gap-3 px-3 py-2.5" : "w-10 h-10 mx-auto justify-center"}`} activeClass="!bg-neutral-800/80 !text-neutral-100" title="Approvals">
            <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            <span class={`${labelClass()} flex-1`}>Approvals</span>
            <Show when={pendingApprovals() > 0}>
              <span class={`transition-all duration-300 ${isActuallyExpanded() ? "text-[9px] font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded-full opacity-100" : "absolute top-1 right-1 min-w-[14px] h-3.5 bg-amber-500 text-[8px] font-bold text-black rounded-full flex items-center justify-center opacity-100 px-1"}`}>
                {approvalsLabel()}
              </span>
            </Show>
          </A>
        </Show>
      </nav>

      {/* Threads — mobile only */}
      <Show when={mobileMenu.isOpen() && (location.pathname === "/" || location.pathname.startsWith("/threads"))}>
        <div class="md:hidden flex flex-col mt-2 px-2.5 flex-1 min-h-0">
          <div class="mx-1 mb-2 border-t border-neutral-800/40" />
          <div class="flex items-center justify-between px-2 pb-1.5">
            <span class="text-[11px] uppercase tracking-[0.12em] text-neutral-500 font-semibold">Threads</span>
            <button
              onClick={() => { mobileMenu.close(); navigate("/"); }}
              class="p-1 text-neutral-400 hover:text-white rounded-md hover:bg-white/8 transition-all"
              title="New thread"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto space-y-px scrollbar-custom">
            <Show when={threads.loading}>
              <div class="space-y-1 px-1">
                <div class="h-8 rounded-lg bg-neutral-800/40 animate-pulse" />
                <div class="h-8 rounded-lg bg-neutral-800/30 animate-pulse" style="animation-delay: 100ms" />
                <div class="h-8 rounded-lg bg-neutral-800/20 animate-pulse" style="animation-delay: 200ms" />
                <div class="h-8 w-3/4 rounded-lg bg-neutral-800/15 animate-pulse" style="animation-delay: 300ms" />
              </div>
            </Show>
            <Show when={!threads.loading && (threads() || []).length === 0}>
              <p class="px-2 py-3 text-xs text-neutral-600">No conversations yet</p>
            </Show>
            <For each={threads() || []}>
              {(thread: any) => (
                <div class="group relative w-full flex items-center rounded-xl hover:bg-white/[0.04] transition-all duration-200">
                  {/* Inline rename editor or thread title */}
                  <Show
                    when={editingThreadId() === thread.id}
                    fallback={
                      <button
                        onClick={() => { mobileMenu.close(); navigate(`/threads/${thread.id}`); }}
                        class="flex-1 text-left px-3 py-2.5 text-[13px] text-neutral-400 hover:text-neutral-100 transition-all duration-150 truncate min-w-0"
                      >
                        {thread.title || "Untitled"}
                      </button>
                    }
                  >
                    <input
                      class="flex-1 mx-2 my-1 px-2.5 py-1.5 text-[13px] bg-neutral-900 border border-neutral-700/50 rounded-lg text-neutral-100 focus:outline-none focus:border-indigo-500/50 transition-colors"
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

                  {/* Three-dot menu button — always visible on mobile */}
                  <Show when={editingThreadId() !== thread.id}>
                    <button
                      onClick={(e) => openThreadMenu(e, thread.id)}
                      class="shrink-0 p-2 mr-1 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-white/5 transition-all duration-200"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                      </svg>
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>

          {/* Portal dropdown menu rendered outside sidebar to avoid clipping */}
          <Show when={menuOpenId() !== null && menuAnchor() !== null}>
            <Portal>
              <div
                class="fixed z-[200] w-40 bg-[#1a1a1a] border border-neutral-800/60 rounded-xl shadow-2xl shadow-black/60 py-1 text-xs animate-fade-in"
                style={{ top: `${menuAnchor()!.top}px`, right: `${menuAnchor()!.right}px` }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  class="w-full text-left px-3 py-2.5 text-neutral-400 hover:bg-white/5 hover:text-white transition-all duration-150 flex items-center gap-2"
                  onClick={() => { mobileMenu.close(); navigate(`/threads/${menuOpenId()}`); setMenuOpenId(null); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l2.5 2.5" /><path d="M21 12a9 9 0 1 1-9-9" /></svg>
                  Memory
                </button>
                <button
                  class="w-full text-left px-3 py-2.5 text-neutral-400 hover:bg-white/5 hover:text-white transition-all duration-150 flex items-center gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    const thread = (threads() || []).find((t: any) => t.id === menuOpenId());
                    if (thread) { setRenameValue(thread.title || ""); setEditingThreadId(thread.id); }
                    setMenuOpenId(null); setMenuAnchor(null);
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  Rename
                </button>
                <button
                  class="w-full text-left px-3 py-2.5 text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-all duration-150 flex items-center gap-2"
                  onClick={(e) => { e.stopPropagation(); const id = menuOpenId()!; setMenuOpenId(null); setMenuAnchor(null); deleteThread(id); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                  Delete
                </button>
              </div>
            </Portal>
          </Show>
        </div>
      </Show>

      {/* Footer */}
      <div class={`mt-auto pb-3 pt-1 flex flex-col gap-0.5 shrink-0 ${isActuallyExpanded() ? "px-2.5" : "items-center"}`} style={{ transition: "padding 400ms cubic-bezier(0.4, 0, 0.2, 1)" }}>
        <A onClick={() => mobileMenu.close()} href="/settings" class={`flex items-center rounded-xl text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-all duration-200 ${isActuallyExpanded() ? "gap-3 px-3 py-2" : "w-9 h-9 mx-auto justify-center"}`} activeClass="!bg-neutral-800/80 !text-neutral-100" title="Settings">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span class={labelClass()}>Settings</span>
        </A>

        {/* Divider */}
        <div class={`my-0.5 ${isActuallyExpanded() ? "mx-3" : "mx-2"} border-t border-neutral-800/40`} />

        <button
          onClick={async () => {
            await auth.logout();
          }}
          class={`flex items-center rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 ${isActuallyExpanded() ? "gap-3 px-3 py-2" : "w-9 h-9 mx-auto justify-center"}`}
          title="Logout"
        >
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span class={labelClass()}>Logout</span>
        </button>

        <button
          onClick={() => setExpanded(!expanded())}
          class={`hidden md:flex items-center rounded-xl text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-all duration-200 ${isActuallyExpanded() ? "gap-3 px-3 py-2" : "w-9 h-9 mx-auto justify-center"}`}
          title={expanded() ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg class="shrink-0" style={{ transform: expanded() ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 400ms cubic-bezier(0.4, 0, 0.2, 1)" }} xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          <span class={`text-[13px] ${labelClass()}`}>Collapse</span>
        </button>
      </div>
    </aside>
    </>
  );
}
