import { Title } from "@solidjs/meta";
import { createResource, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { NotificationItem } from "../components/chat/NotificationItem";
import { notificationsApi } from "../lib/api";

export default function Notifications() {
  const [notifications, { refetch }] = createResource(() => notificationsApi.getAll());
  let sse: EventSource | undefined;

  onMount(() => {
    // Subscribe to live SSE stream for real-time notifications
    sse = notificationsApi.openStream();
    sse.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "notification") refetch();
      } catch { /* ignore parse errors */ }
    };
    sse.onerror = () => console.warn("[SSE] Notification stream connection error");
  });

  onCleanup(() => sse?.close());

  async function markRead(id: string) {
    try {
      await notificationsApi.markRead(id);
      await refetch();
    } catch (e: any) {
      console.error("Mark read failed:", e.message);
    }
  }

  const typeMap = (t: string): "approval_request" | "workflow_event" | "system" => {
    if (t === "approval_request") return "approval_request";
    if (t === "workflow_event") return "workflow_event";
    return "system";
  };

  return (
    <>
      <Title>Notifications — AutoPilot</Title>
      <main class="flex-1 flex flex-col h-full bg-[#111111] min-w-0">
        <header class="px-6 py-4 border-b border-neutral-800/20 flex items-center justify-between shrink-0">
          <div>
            <h1 class="text-[14px] font-medium text-neutral-200">Notifications</h1>
            <p class="text-[12px] text-neutral-600 mt-0.5">Live inbox for all system events.</p>
          </div>
          <div class="flex items-center gap-3">
            {/* SSE live indicator */}
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span class="text-[11px] text-neutral-500">Live</span>
            </div>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto">
          <div class="max-w-3xl mx-auto">
            <Show when={notifications.loading}>
              <div class="px-6 py-8 flex items-center gap-2 text-sm text-neutral-500">
                <div class="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                Loading notifications…
              </div>
            </Show>

            <Show when={!notifications.loading && (notifications() || []).length === 0}>
              <div class="px-6 py-16 text-center text-neutral-600 text-sm">
                No notifications yet. Events from workflow executions will appear here.
              </div>
            </Show>

            <For each={notifications() || []}>
              {(n: any) => (
                <NotificationItem
                  type={typeMap(n.type)}
                  title={n.title}
                  message={n.message}
                  time={new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  isRead={n.read}
                  onMarkRead={() => markRead(n.id)}
                />
              )}
            </For>
          </div>
        </div>
      </main>
    </>
  );
}
