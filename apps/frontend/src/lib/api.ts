import type {
  AccountInfoDto,
  ApprovalDto,
  AuthStateDto,
  ChatAttachmentDto,
  ChatMessageDto,
  ChatThreadDto,
  NotificationDto,
  ProviderConfigDto,
  RuntimePreferencesDto,
  SafeUserDto,
  WorkflowDto,
  WorkflowRunDto,
  WebhookSecretDto,
} from "@autopilot/shared";
import { API_BASE_URL } from "./api-base";

// Central API client for the AutoPilot backend
// Base URL: defaults to localhost in dev, can be overridden via VITE_API_URL
const BASE_URL = API_BASE_URL;

async function readJsonSafe(res: Response): Promise<any | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Detects the browser timezone used for API request context headers.
 *
 * @returns IANA timezone string when available, otherwise `undefined`.
 */
function getBrowserTimezone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.trim() ? tz.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the CSRF token cookie used for state-changing API requests.
 *
 * @returns CSRF token from cookie storage when present.
 */
function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ap_csrf="));
  if (!match) return undefined;
  const value = match.slice("ap_csrf=".length);
  return value ? decodeURIComponent(value) : undefined;
}

/**
 * Executes an authenticated API request and unwraps the standard response envelope.
 *
 * @param path - API path under the backend base URL.
 * @param options - Fetch options for method/body/headers overrides.
 * @returns Unwrapped `data` payload from API envelope, or raw JSON fallback.
 * @throws {Error} When response status is non-2xx.
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const timezone = getBrowserTimezone();
  const csrfToken = getCsrfToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(timezone ? { "x-user-timezone": timezone } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...options?.headers,
    },
    ...options,
  });
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  if (!res.ok) {
    const body = isJson ? await readJsonSafe(res) : null;
    const errorMessage =
      body?.error?.message ||
      body?.error ||
      `HTTP ${res.status}`;
    throw new Error(errorMessage);
  }
  if (!isJson) {
    throw new Error(`Expected JSON response, got ${contentType || "unknown content-type"}`);
  }
  const json = await readJsonSafe(res);
  if (!json) {
    throw new Error("Failed to parse JSON response");
  }
  return json.data ?? json;
}

// ─── SSE stream parser ────────────────────────────────────────────────────────

/**
 * Parsed SSE event emitted by streaming endpoints.
 */
export type SseEvent = { event: string; data: any };

/**
 * Parses a text/event-stream response body into structured events.
 *
 * @param response - Fetch response with an SSE body.
 * @yields Parsed SSE event objects.
 */
async function* parseSseStream(response: Response): AsyncGenerator<SseEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE messages are separated by double newline
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim() || part.startsWith(":")) continue; // skip comments/heartbeats
        let event = "message";
        let data = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) data = line.slice(6).trim();
        }
        if (data) {
          try { yield { event, data: JSON.parse(data) }; } catch { /* malformed */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Chat ────────────────────────────────────────────────────────────────────
/** Client wrapper for chat threads/messages, attachments, and streaming endpoints. */
export const chatApi = {
  getThreads: (params?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.before) qs.set("before", params.before);
    return request<ChatThreadDto[]>(`/api/chat/threads${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  createThread: (title?: string) =>
    request<ChatThreadDto>("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({ title: title || "New Thread" }),
    }),
  getMessages: (threadId: string, params?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.before) qs.set("before", params.before);
    return request<ChatMessageDto[]>(`/api/chat/threads/${threadId}/messages${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  uploadAttachments: async (threadId: string, files: File[], providerId?: string, model?: string) => {
    const form = new FormData();
    form.append("threadId", threadId);
    if (providerId) form.append("providerId", providerId);
    if (model) form.append("model", model);
    for (const file of files) form.append("files", file);
    const timezone = getBrowserTimezone();
    const csrfToken = getCsrfToken();
    const res = await fetch(`${BASE_URL}/api/chat/attachments`, {
      method: "POST",
      credentials: "include",
      headers: {
        ...(timezone ? { "x-user-timezone": timezone } : {}),
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return (json.data ?? []) as ChatAttachmentDto[];
  },
  getAttachment: (id: string) => request<ChatAttachmentDto>(`/api/chat/attachments/${id}`),
  deleteAttachment: (id: string) => request<ChatAttachmentDto>(`/api/chat/attachments/${id}`, { method: "DELETE" }),

  /** Legacy non-streaming send — kept as fallback */
  sendMessage: (threadId: string, content: string, providerId?: string, model?: string, attachmentIds?: string[]) =>
    request<{ userMessage: ChatMessageDto; assistantReply: ChatMessageDto }>(
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ role: "user", content, providerId, model, attachmentIds: attachmentIds || [] }),
      }
    ),

  /** Streaming send — yields SSE events as they arrive from the backend. */
  async *sendMessageStream(
    threadId: string,
    content: string,
    providerId?: string,
    model?: string,
    attachmentIds?: string[],
  ): AsyncGenerator<SseEvent> {
    const timezone = getBrowserTimezone();
    const csrfToken = getCsrfToken();
    const response = await fetch(`${BASE_URL}/api/chat/threads/${threadId}/messages/stream`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(timezone ? { "x-user-timezone": timezone } : {}),
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      body: JSON.stringify({ role: "user", content, providerId, model, attachmentIds: attachmentIds || [] }),
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    yield* parseSseStream(response);
  },

  answerQuestionInline: (
    threadId: string,
    messageId: string,
    questionId: string,
    payload: { optionId?: string; valueToSend: string; providerId?: string; model?: string },
  ) =>
    request<{ message: ChatMessageDto }>(
      `/api/chat/threads/${threadId}/messages/${messageId}/questions/${questionId}/answer`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  sendClientTelemetry: (payload: {
    level: "info" | "warn" | "error";
    category: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) =>
    request<{ status: string }>(`/api/chat/client-telemetry`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  renameThread: (threadId: string, title: string) =>
    request<ChatThreadDto>(`/api/chat/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deleteThread: (threadId: string) =>
    request<ChatThreadDto>(`/api/chat/threads/${threadId}`, { method: "DELETE" }),
  deleteAllThreads: () =>
    request<{ deletedCount: number }>(`/api/chat/threads`, { method: "DELETE" }),
};

// ─── Workflows ───────────────────────────────────────────────────────────────
/** Client wrapper for workflow registry, execution, and run history endpoints. */
export const workflowsApi = {
  getAll: (filters?: { provider?: string; visibility?: string; enabled?: string; archived?: string; search?: string }) => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    }
    const qs = params.toString();
    return request<WorkflowDto[]>(`/api/workflows${qs ? `?${qs}` : ""}`);
  },
  getById: (id: string) => request<WorkflowDto>(`/api/workflows/${id}`),
  create: (data: Record<string, unknown>) =>
    request<WorkflowDto>("/api/workflows", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Record<string, unknown>) =>
    request<WorkflowDto>(`/api/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string, mode?: "hard" | "archive") =>
    request<{ id: string; archived?: boolean }>(`/api/workflows/${id}${mode === "hard" ? "?mode=hard" : ""}`, {
      method: "DELETE",
    }),
  trigger: (id: string, payload?: { source?: string; input?: Record<string, unknown> }) =>
    request<{
      runId: string;
      workflowId: string;
      status: WorkflowRunDto["status"];
      traceId?: string;
      adapterStatus?: "accepted" | "error";
      mode?: "provider" | "sim";
    }>(`/api/workflows/${id}/trigger`, {
      method: "POST",
      body: JSON.stringify(payload || { source: "ui", input: {} }),
    }),
  getRuns: (workflowId: string, params?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.before) qs.set("before", params.before);
    return request<WorkflowRunDto[]>(`/api/workflows/${workflowId}/runs${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  getRunById: (runId: string, includeRaw?: boolean) =>
    request<WorkflowRunDto & { workflow?: WorkflowDto }>(`/api/workflow-runs/${runId}${includeRaw ? "?includeRaw=true" : ""}`),
  validate: (id: string) =>
    request<{ valid: boolean; errors?: string[] }>(`/api/workflows/${id}/validate`, { method: "POST" }),
  testConnection: (executionEndpoint: string) =>
    request<{ ok: boolean; latencyMs?: number }>("/api/workflows/test-connection", {
      method: "POST",
      body: JSON.stringify({ executionEndpoint }),
    }),
};

// ─── Approvals ───────────────────────────────────────────────────────────────
export const approvalsApi = {
  getPending: () => request<ApprovalDto[]>("/api/approvals"),
  resolve: (id: string, status: "approved" | "rejected") =>
    request<ApprovalDto>(`/api/approvals/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
};

// ─── Notifications ───────────────────────────────────────────────────────────
export const notificationsApi = {
  openStream: () => new EventSource(`${BASE_URL}/api/notifications/stream`, { withCredentials: true }),
  getAll: (params?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.before) qs.set("before", params.before);
    return request<NotificationDto[]>(`/api/notifications${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  markRead: (id: string) =>
    request<NotificationDto>(`/api/notifications/${id}/read`, { method: "POST" }),
  clearAll: () =>
    request<{ deletedCount: number }>("/api/notifications", { method: "DELETE" }),
  getPushPublicKey: () =>
    request<{ publicKey: string }>("/api/notifications/push/public-key"),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    request<{ id: string; endpoint: string }>("/api/notifications/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
    }),
  unsubscribePush: (endpoint: string) =>
    request<{ revoked: boolean } | null>("/api/notifications/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    }),
  sendPushTest: () =>
    request<{ sent: boolean }>("/api/notifications/push/test", { method: "POST" }),
};

// ─── Auth ───────────────────────────────────────────────────────────────────

/**
  * auth state mode type alias.
  */
export type AuthStateMode = AuthStateDto["mode"];
/**
  * auth state payload type alias.
  */
export type AuthStatePayload = AuthStateDto;
/**
  * account info type alias.
  */
export type AccountInfo = AccountInfoDto;
/**
  * runtime preferences type alias.
  */
export type RuntimePreferences = RuntimePreferencesDto;
export const authApi = {
  getState: () => request<AuthStatePayload>("/api/auth/state"),
  getMe: () => request<{ user: SafeUserDto }>("/api/auth/me"),
  getAccount: () => request<AccountInfo>("/api/auth/account"),
  registerOnboarding: (payload: { email: string; name?: string; password: string }) =>
    request<{ user: SafeUserDto }>("/api/auth/onboarding/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    request<{ user: SafeUserDto }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateProfile: (payload: { name: string; timezone?: string | null }) =>
    request<{ user: SafeUserDto }>("/api/auth/account/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updateEmail: (payload: { email: string; currentPassword: string }) =>
    request<{ user: SafeUserDto }>("/api/auth/account/email", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updatePassword: (payload: { currentPassword: string; newPassword: string }) =>
    request<{ updated: boolean }>("/api/auth/account/password", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  logout: () => request<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST" }),
  googleStartUrl: () => `${BASE_URL}/api/auth/google/start`,
};

// ─── Settings ────────────────────────────────────────────────────────────────
export const settingsApi = {
  getProviders: () => request<ProviderConfigDto[]>("/api/settings/providers"),
  getRuntimePreferences: () => request<RuntimePreferencesDto>("/api/settings/runtime-preferences"),
  updateRuntimePreferences: (payload: Partial<RuntimePreferencesDto>) =>
    request<RuntimePreferencesDto>("/api/settings/runtime-preferences", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  saveProviderConfig: (payload: { provider: string; model: string; apiKey?: string; baseUrl?: string; customName?: string }) =>
    request<ProviderConfigDto>("/api/settings/providers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteProvider: (id: string) =>
    request<ProviderConfigDto>(`/api/settings/providers/${id}`, { method: "DELETE" }),
  setActiveProvider: (id: string) =>
    request<ProviderConfigDto>(`/api/settings/providers/${id}/active`, { method: "POST" }),
  updateProviderModel: (id: string, model: string) =>
    request<ProviderConfigDto>(`/api/settings/providers/${id}/model`, {
      method: "PATCH",
      body: JSON.stringify({ model }),
    }),
  fetchModels: (payload: { provider: string; providerId?: string; baseUrl?: string; apiKey?: string }) =>
    request<string[]>("/api/settings/fetch-models", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getWebhookSecrets: () => request<WebhookSecretDto[]>("/api/settings/webhook-secrets"),
  createWebhookSecret: (payload?: { label?: string }) =>
    request<WebhookSecretDto>("/api/settings/webhook-secrets", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),
  revokeWebhookSecret: (id: string) =>
    request<WebhookSecretDto>(`/api/settings/webhook-secrets/${id}`, {
      method: "DELETE",
    }),
};
