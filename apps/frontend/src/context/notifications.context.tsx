import {
  ParentComponent,
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { notificationsApi } from "../lib/api";

export type AppNotificationType = "workflow_event" | "approval_request" | "system";
export type NotificationConnectionState = "connecting" | "live" | "offline";
export type PushPermissionState = "unsupported" | "default" | "granted" | "denied";

export interface InboxNotification {
  id: string;
  type: AppNotificationType;
  title: string;
  message?: string;
  read: boolean;
  createdAt: string;
  runId?: string;
  data?: unknown;
}

export interface ToastNotification {
  id: string;
  type: AppNotificationType;
  title: string;
  message?: string;
  createdAt: string;
  runId?: string;
}

type NotificationsContextValue = {
  notifications: () => InboxNotification[];
  toasts: () => ToastNotification[];
  loading: () => boolean;
  connectionState: () => NotificationConnectionState;
  unreadCount: () => number;
  lastEventId: () => string | null;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markManyRead: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
  dismissToast: (id: string) => void;
  pushPermission: () => PushPermissionState;
  enablingPush: () => boolean;
  enablePush: () => Promise<boolean>;
  testPush: () => Promise<void>;
  unmutePushTopics: () => void;
};

const notificationsContextDefaults: NotificationsContextValue = {
  notifications: () => [],
  toasts: () => [],
  loading: () => false,
  connectionState: () => "offline",
  unreadCount: () => 0,
  lastEventId: () => null,
  refresh: async () => {},
  markRead: async () => {},
  markManyRead: async () => {},
  clearAll: async () => {},
  dismissToast: () => {},
  pushPermission: () => "unsupported",
  enablingPush: () => false,
  enablePush: async () => false,
  testPush: async () => {},
  unmutePushTopics: () => {},
};

const NotificationsContext = createContext<NotificationsContextValue>(notificationsContextDefaults);

function toUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function normalizeNotification(input: any): InboxNotification {
  return {
    id: String(input.id),
    type: input.type as AppNotificationType,
    title: String(input.title || "Notification"),
    message: input.message ? String(input.message) : undefined,
    read: Boolean(input.read),
    createdAt: String(input.createdAt || new Date().toISOString()),
    runId: input.runId ? String(input.runId) : undefined,
    data: input.data,
  };
}

export const NotificationsProvider: ParentComponent = (props) => {
  const [notifications, setNotifications] = createSignal<InboxNotification[]>([]);
  const [toasts, setToasts] = createSignal<ToastNotification[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [connectionState, setConnectionState] = createSignal<NotificationConnectionState>("connecting");
  const [lastEventId, setLastEventId] = createSignal<string | null>(null);
  const [enablingPush, setEnablingPush] = createSignal(false);
  const [pushPermission, setPushPermission] = createSignal<PushPermissionState>(
    typeof window !== "undefined" && "Notification" in window
      ? (Notification.permission as PushPermissionState)
      : "unsupported",
  );
  let sse: EventSource | undefined;
  const toastTimers = new Map<string, number>();

  const unreadCount = createMemo(() => notifications().filter((item) => !item.read).length);

  async function refresh() {
    setLoading(true);
    try {
      const data = await notificationsApi.getAll();
      setNotifications((data || []).map(normalizeNotification));
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    const current = notifications().find((item) => item.id === id);
    if (!current || current.read) return;

    setNotifications((items) =>
      items.map((item) => (item.id === id ? { ...item, read: true } : item))
    );

    try {
      await notificationsApi.markRead(id);
    } catch (err) {
      setNotifications((items) =>
        items.map((item) => (item.id === id ? { ...item, read: false } : item))
      );
      throw err;
    }
  }

  async function markManyRead(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    for (const id of uniqueIds) {
      await markRead(id);
    }
  }

  function dismissToast(id: string) {
    const timer = toastTimers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimers.delete(id);
    }
    setToasts((items) => items.filter((item) => item.id !== id));
  }

  function enqueueToast(notification: InboxNotification) {
    dismissToast(notification.id);

    setToasts((items) => [
      {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        createdAt: notification.createdAt,
        runId: notification.runId,
      },
      ...items,
    ].slice(0, 4));

    const timer = window.setTimeout(() => {
      dismissToast(notification.id);
    }, 5000);

    toastTimers.set(notification.id, timer);
  }

  function clearAllToasts() {
    for (const timer of toastTimers.values()) {
      window.clearTimeout(timer);
    }
    toastTimers.clear();
    setToasts([]);
  }

  async function clearAll() {
    const snapshot = notifications();
    setNotifications([]);
    clearAllToasts();

    try {
      await notificationsApi.clearAll();
    } catch (err) {
      setNotifications(snapshot);
      throw err;
    }
  }

  async function enablePush(): Promise<boolean> {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) {
      setPushPermission("unsupported");
      return false;
    }

    setEnablingPush(true);
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission as PushPermissionState);
      if (permission !== "granted") return false;

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await notificationsApi.subscribePush(existing.toJSON());
        return true;
      }

      const keyData = await notificationsApi.getPushPublicKey();
      const applicationServerKey = toUint8Array(keyData.publicKey) as unknown as BufferSource;
      const created = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      await notificationsApi.subscribePush(created.toJSON());
      return true;
    } catch (err) {
      console.error("Enable push failed:", err);
      return false;
    } finally {
      setEnablingPush(false);
    }
  }

  async function testPush() {
    await notificationsApi.sendPushTest();
  }

  function unmutePushTopics() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.controller?.postMessage({ type: "PUSH_UNMUTE_ALL" });
  }

  function upsertNotification(input: any) {
    const incoming = normalizeNotification(input);
    setLastEventId(incoming.id);
    setNotifications((items) => {
      const existingIdx = items.findIndex((item) => item.id === incoming.id);
      if (existingIdx >= 0) {
        const copy = items.slice();
        copy[existingIdx] = { ...copy[existingIdx], ...incoming };
        return copy;
      }
      enqueueToast(incoming);
      return [incoming, ...items];
    });
  }

  onMount(() => {
    refresh();
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushPermission(Notification.permission as PushPermissionState);
    }

    sse = notificationsApi.openStream();
    sse.onopen = () => setConnectionState("live");
    sse.onmessage = (event) => {
      setConnectionState("live");
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "notification" && parsed.data) {
          upsertNotification(parsed.data);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };
    sse.onerror = () => setConnectionState("offline");
  });

  onCleanup(() => {
    sse?.close();
    for (const timer of toastTimers.values()) {
      window.clearTimeout(timer);
    }
    toastTimers.clear();
  });

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        toasts,
        loading,
        connectionState,
        unreadCount,
        lastEventId,
        refresh,
        markRead,
        markManyRead,
        clearAll,
        dismissToast,
        pushPermission,
        enablingPush,
        enablePush,
        testPush,
        unmutePushTopics,
      }}
    >
      {props.children}
    </NotificationsContext.Provider>
  );
};

export function useNotifications() {
  return useContext(NotificationsContext) || notificationsContextDefaults;
}
