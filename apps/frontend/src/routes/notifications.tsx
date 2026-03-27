import { Title } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { NotificationItem } from "../components/chat/NotificationItem";
import { NotificationPreviewPanel } from "../components/notifications/NotificationPreviewPanel";
import { useNotifications, type AppNotificationType, type InboxNotification } from "../context/notifications.context";
import { usePanel } from "../context/panel.context";
import { chatApi, workflowsApi } from "../lib/api";
import { buildFollowUpDraft, getNotificationDisplayTitle, getWorkflowInsight } from "../lib/notification-insights";

type NotificationFilter = "all" | "unread" | AppNotificationType;

const filterChips: Array<{ key: NotificationFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "workflow_event", label: "Workflow" },
  { key: "approval_request", label: "Approval" },
  { key: "system", label: "System" },
];

function isToday(date: Date) {
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function isYesterday(date: Date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === yesterday.toDateString();
}

function groupLabelForDate(value: string) {
  const date = new Date(value);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return "Earlier";
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function connectionMeta(state: "connecting" | "live" | "offline") {
  if (state === "live") {
    return { label: "Live", dot: "bg-emerald-500 animate-pulse", text: "text-emerald-300" };
  }
  if (state === "connecting") {
    return { label: "Connecting", dot: "bg-amber-400 animate-pulse", text: "text-amber-300" };
  }
  return { label: "Offline", dot: "bg-neutral-500", text: "text-neutral-400" };
}

export default function Notifications() {
  const navigate = useNavigate();
  const { openPanel } = usePanel();
  const {
    notifications,
    loading,
    connectionState,
    unreadCount,
    lastEventId,
    refresh,
    markRead,
    markManyRead,
    clearAll,
    pushPermission,
    enablingPush,
    enablePush,
    testPush,
    unmutePushTopics,
  } = useNotifications();

  const [activeFilter, setActiveFilter] = createSignal<NotificationFilter>("all");
  const [freshIds, setFreshIds] = createSignal<string[]>([]);
  const [newWhileAwayCount, setNewWhileAwayCount] = createSignal(0);
  const [markingAll, setMarkingAll] = createSignal(false);
  const [clearingAll, setClearingAll] = createSignal(false);
  const [showClearAllModal, setShowClearAllModal] = createSignal(false);
  const [routingId, setRoutingId] = createSignal<string | null>(null);
  const [scrolledAway, setScrolledAway] = createSignal(false);
  let scrollRef: HTMLDivElement | undefined;

  const filteredNotifications = createMemo(() => {
    const filter = activeFilter();
    return notifications().filter((item) => {
      if (filter === "all") return true;
      if (filter === "unread") return !item.read;
      return item.type === filter;
    });
  });

  const groupedNotifications = createMemo(() => {
    const groups = new Map<string, InboxNotification[]>();
    for (const item of filteredNotifications()) {
      const label = groupLabelForDate(item.createdAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(item);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  });

  const visibleUnreadIds = createMemo(() =>
    filteredNotifications()
      .filter((item) => !item.read)
      .map((item) => item.id)
  );

  createEffect(() => {
    const incomingId = lastEventId();
    if (!incomingId) return;

    setFreshIds((ids) => [incomingId, ...ids.filter((id) => id !== incomingId)]);
    if (scrolledAway()) {
      setNewWhileAwayCount((count) => count + 1);
    }

    const timer = window.setTimeout(() => {
      setFreshIds((ids) => ids.filter((id) => id !== incomingId));
    }, 2200);

    onCleanup(() => window.clearTimeout(timer));
  });

  function handleScroll() {
    const top = scrollRef?.scrollTop || 0;
    const away = top > 28;
    setScrolledAway(away);
    if (!away) setNewWhileAwayCount(0);
  }

  async function handlePreview(notification: InboxNotification) {
    if (!notification.read) {
      markRead(notification.id).catch((err: unknown) => console.error("Mark read failed:", err));
    }

    openPanel({
      title: getNotificationDisplayTitle(notification),
      content: (
        <NotificationPreviewPanel
          notification={notification}
          onOpenWorkflow={(workflowId) => navigate(`/workflows/${workflowId}`)}
          onOpenApprovals={() => navigate("/approvals")}
          onFollowUp={(question) => handleFollowUp(notification, question)}
        />
      ),
    });
  }

  async function handleFollowUp(notification: InboxNotification, question?: string) {
    const insight = getWorkflowInsight(notification);
    const draft = buildFollowUpDraft(notification, insight, question);
    const baseTitle = insight?.workflowKey || notification.title;
    const threadTitle = `Follow-up: ${baseTitle}`.slice(0, 48);

    try {
      const thread = await chatApi.createThread(threadTitle);
      navigate(`/threads/${thread.id}?draft=${encodeURIComponent(draft)}&autosend=1`);
    } catch (err) {
      console.error("Follow-up thread creation failed:", err);
    }
  }

  async function handleOpenRoute(notification: InboxNotification) {
    if (!notification.read) {
      markRead(notification.id).catch((err: unknown) => console.error("Mark read failed:", err));
    }

    if (notification.type === "approval_request") {
      navigate("/approvals");
      return;
    }

    if (notification.type === "workflow_event" && notification.runId) {
      setRoutingId(notification.id);
      try {
        const run = await workflowsApi.getRunById(notification.runId);
        if (run?.workflowId) {
          navigate(`/workflows/${run.workflowId}`);
          return;
        }
      } catch (err) {
        console.error("Workflow route lookup failed:", err);
      } finally {
        setRoutingId(null);
      }
    }

    handlePreview(notification);
  }

  async function handleMarkAllVisible() {
    const ids = visibleUnreadIds();
    if (ids.length === 0) return;

    setMarkingAll(true);
    try {
      await markManyRead(ids);
    } catch (err) {
      console.error("Mark all visible failed:", err);
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleClearAll() {
    if (notifications().length === 0) return;

    setClearingAll(true);
    try {
      await clearAll();
      setShowClearAllModal(false);
    } catch (err) {
      console.error("Clear all notifications failed:", err);
      await refresh();
    } finally {
      setClearingAll(false);
    }
  }

  const emptyStateCopy = createMemo(() => {
    if (activeFilter() === "unread") return "No unread notifications. You're fully caught up.";
    if (activeFilter() === "workflow_event") return "No workflow events yet. Run activity will land here.";
    if (activeFilter() === "approval_request") return "No approval notifications right now.";
    if (activeFilter() === "system") return "No system notices at the moment.";
    return "No notifications yet. Autonomous workflow results will appear here.";
  });

  const liveMeta = createMemo(() => connectionMeta(connectionState()));

  return (
    <>
      <Title>Notifications — AutoPilot</Title>
      <main class="flex-1 flex flex-col h-full bg-[#111111] min-w-0">
        <header class="px-6 py-4 border-b border-neutral-800/20 shrink-0">
          <div class="max-w-5xl mx-auto flex flex-col gap-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div class="flex items-center gap-2.5">
                  <h1 class="page-title">Notifications</h1>
                  <Show when={unreadCount() > 0}>
                    <span class="text-[10px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded-full">
                      {unreadCount()} unread
                    </span>
                  </Show>
                </div>
                <p class="page-subtitle">Inbox for autonomous workflow results, approvals, and system events.</p>
              </div>

              <div class="flex items-center gap-3">
                <button
                  onClick={() => enablePush().catch((err: unknown) => console.error("Enable push failed:", err))}
                  disabled={enablingPush() || pushPermission() === "granted"}
                  class={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-200 ${
                    enablingPush() || pushPermission() === "granted"
                      ? "border-neutral-800/60 text-neutral-600 cursor-not-allowed"
                      : "border-blue-500/30 text-blue-200 hover:text-white hover:border-blue-400/45 hover:bg-blue-500/10"
                  }`}
                >
                  {pushPermission() === "granted" ? "Push enabled" : enablingPush() ? "Enabling..." : "Enable push"}
                </button>
                <Show when={pushPermission() === "granted"}>
                  <button
                    onClick={() => testPush().catch((err: unknown) => console.error("Push test failed:", err))}
                    class="text-xs px-3 py-1.5 rounded-lg border border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-900/70 transition-all duration-200"
                  >
                    Test push
                  </button>
                  <button
                    onClick={unmutePushTopics}
                    class="text-xs px-3 py-1.5 rounded-lg border border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-900/70 transition-all duration-200"
                  >
                    Unmute topics
                  </button>
                </Show>
                <div class="flex items-center gap-1.5 rounded-full border border-neutral-800/70 bg-neutral-900/60 px-3 py-1.5">
                  <span class={`w-1.5 h-1.5 rounded-full ${liveMeta().dot}`} />
                  <span class={`text-[11px] ${liveMeta().text}`}>{liveMeta().label}</span>
                </div>
                <button
                  onClick={() => refresh()}
                  class="text-xs text-neutral-400 hover:text-white transition-colors"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex flex-wrap items-center gap-2">
                <For each={filterChips}>
                  {(chip) => (
                    <button
                      onClick={() => setActiveFilter(chip.key)}
                      class={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
                        activeFilter() === chip.key
                          ? "bg-neutral-100 text-neutral-950 border-neutral-100"
                          : "bg-neutral-900/60 text-neutral-400 border-neutral-800/70 hover:text-neutral-100 hover:border-neutral-700"
                      }`}
                    >
                      {chip.label}
                    </button>
                  )}
                </For>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleMarkAllVisible}
                  disabled={visibleUnreadIds().length === 0 || markingAll()}
                  class={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-200 ${
                    visibleUnreadIds().length === 0 || markingAll()
                      ? "border-neutral-800/60 text-neutral-600 cursor-not-allowed"
                      : "border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-900/70"
                  }`}
                >
                  {markingAll() ? "Marking..." : "Mark all visible read"}
                </button>
                <button
                  onClick={() => setShowClearAllModal(true)}
                  disabled={notifications().length === 0 || clearingAll()}
                  class={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-200 ${
                    notifications().length === 0 || clearingAll()
                      ? "border-neutral-800/60 text-neutral-600 cursor-not-allowed"
                      : "border-red-500/20 text-red-300 hover:text-red-200 hover:border-red-400/40 hover:bg-red-500/10"
                  }`}
                >
                  {clearingAll() ? "Clearing..." : "Clear all"}
                </button>
              </div>
            </div>
          </div>
        </header>

        <div ref={scrollRef} onScroll={handleScroll} class="flex-1 overflow-y-auto scrollbar-custom">
          <div class="max-w-5xl mx-auto px-6 py-6">
            <Show when={newWhileAwayCount() > 0}>
              <div class="sticky top-0 z-10 mb-4 flex justify-center">
                <button
                  onClick={() => {
                    scrollRef?.scrollTo({ top: 0, behavior: "smooth" });
                    setNewWhileAwayCount(0);
                  }}
                  class="rounded-full border border-blue-500/25 bg-blue-500/12 px-4 py-2 text-xs font-medium text-blue-200 shadow-[0_14px_32px_rgba(0,0,0,0.28)] backdrop-blur-sm hover:bg-blue-500/18 transition-colors"
                >
                  {newWhileAwayCount()} new {newWhileAwayCount() === 1 ? "notification" : "notifications"}
                </button>
              </div>
            </Show>

            <Show when={loading() && notifications().length === 0}>
              <div class="rounded-2xl border border-neutral-800/70 bg-neutral-900/45 px-5 py-6 flex items-center gap-3 text-sm text-neutral-400">
                <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Loading notifications...
              </div>
            </Show>

            <Show when={!loading() && filteredNotifications().length === 0}>
              <div class="rounded-3xl border border-neutral-800/70 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_55%),#111111] px-6 py-14 text-center">
                <div class="mx-auto w-12 h-12 rounded-2xl border border-neutral-800/80 bg-neutral-900/70 flex items-center justify-center text-neutral-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <p class="mt-4 text-sm font-medium text-neutral-200">{emptyStateCopy()}</p>
                <p class="mt-2 text-xs text-neutral-500">Try another filter or wait for the next workflow event.</p>
              </div>
            </Show>

            <div class="space-y-8">
              <For each={groupedNotifications()}>
                {(group) => (
                  <section>
                    <div class="flex items-center gap-3 mb-3">
                      <p class="text-[10px] uppercase tracking-[0.18em] text-neutral-500 font-semibold">{group.label}</p>
                      <div class="h-px flex-1 bg-neutral-800/70" />
                    </div>

                    <div class="space-y-3">
                      <For each={group.items}>
                        {(notification) => (
                          <NotificationItem
                            title={getNotificationDisplayTitle(notification)}
                            message={notification.message}
                            type={notification.type}
                            isRead={notification.read}
                            isNew={freshIds().includes(notification.id)}
                            runId={notification.runId}
                            timeLabel={timeLabel(notification.createdAt)}
                            dateLabel={dateLabel(notification.createdAt)}
                            previewLabel="Preview"
                            ctaLabel={
                              notification.type === "approval_request"
                                ? "Open approvals"
                                : notification.type === "workflow_event" && notification.runId
                                  ? routingId() === notification.id
                                    ? "Opening..."
                                    : "Open workflow"
                                  : undefined
                            }
                            summary={getWorkflowInsight(notification)?.summary}
                            summaryBullets={getWorkflowInsight(notification)?.bullets}
                            rawPreview={getWorkflowInsight(notification)?.rawPreview}
                            onPreview={() => handlePreview(notification)}
                            onOpenRoute={
                              notification.type === "approval_request" || (notification.type === "workflow_event" && notification.runId)
                                ? () => handleOpenRoute(notification)
                                : undefined
                            }
                            onFollowUp={getWorkflowInsight(notification) ? () => handleFollowUp(notification) : undefined}
                            onMarkRead={() => markRead(notification.id).catch((err: unknown) => console.error("Mark read failed:", err))}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </div>
        </div>
      </main>

      <Show when={showClearAllModal()}>
        <div
          class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => !clearingAll() && setShowClearAllModal(false)}
        >
          <div
            class="bg-[#1a1a1a] border border-neutral-800/60 rounded-2xl shadow-2xl shadow-black/80 p-8 w-[420px] max-w-[calc(100vw-2rem)] animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center gap-4 mb-5">
              <div class="w-11 h-11 rounded-2xl flex items-center justify-center bg-red-500/12">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </div>
              <div>
                <h3 class="text-[16px] font-semibold text-white">Clear all notifications?</h3>
                <p class="text-[13px] text-neutral-500 mt-1">
                  This will remove every notification currently in the inbox. This action cannot be undone.
                </p>
              </div>
            </div>

            <div class="flex items-center gap-3 justify-end mt-6">
              <button
                onClick={() => setShowClearAllModal(false)}
                disabled={clearingAll()}
                class="px-5 py-2 text-[13px] text-neutral-400 hover:text-white bg-neutral-800/50 hover:bg-neutral-700/60 rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                disabled={clearingAll()}
                class="px-5 py-2 text-[13px] font-medium rounded-lg transition-all duration-150 bg-red-500/80 hover:bg-red-500/90 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clearingAll() ? "Clearing..." : "Clear all"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
