/**
 * @fileoverview apps/frontend/src/lib/api.ts
 *
 * High-level purpose:
 * Frontend utility/integration module for API communication and shared client-side helper behavior.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Abstracts transport and formatting details from UI components.
 * - Provides reusable helper contracts for request/response workflows.
 * - Keeps client integration logic testable and centrally maintained.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import helper functions into components, routes, or contexts.
 * 2. Compose utilities with domain-specific UI behavior in callers.
 * 3. Update associated unit tests when changing helper contracts.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import type {
  AccountInfoDto,
  ApiEnvelope,
  ApprovalDto,
  AuthStateDto,
  ChatAttachmentDto,
  ChatMessageDto,
  ChatThreadDto,
  MfaStatusDto,
  NotificationDto,
  ProviderConfigDto,
  RuntimePreferencesDto,
  RetrievalPreferencesDto,
  ThreadMemoryInsightDto,
  ThreadMemoryInsightsMetaDto,
  SafeUserDto,
  TotpSetupDto,
  WorkflowDto,
  WorkflowRunDto,
  WebhookSecretDto,
} from "@autopilot/shared";
import { API_BASE_URL } from "./api-base";

// Central API client for the AutoPilot backend
// Base URL: defaults to localhost in dev, can be overridden via VITE_API_URL
const BASE_URL = API_BASE_URL;
const MODEL_DISCOVERY_CACHE_TTL_MS = 30_000;
const MODEL_DISCOVERY_CACHE_MAX_ENTRIES = 64;
const modelListCache = new Map<string, { expiresAt: number; value: string[] }>();
const providerCapabilitiesCache = new Map<string, { expiresAt: number; value: ProviderModelCapabilities }>();

async function readJsonSafe(res: Response): Promise<any | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Default timeout for non-streaming API requests (30 seconds). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sanitizes API error messages to prevent leaking backend internals to users.
 *
 * @param raw - Raw error string from API response or thrown error.
 * @returns Sanitized error message safe for user display.
 */
function sanitizeApiError(raw: string): string {
  if (!raw) return "An unexpected error occurred.";
  // Strip stack traces (e.g. "at Module._compile (/app/src/...")
  if (/\bat\s+\S+\s*\(/.test(raw)) return "An unexpected error occurred.";
  // Strip messages that look like file paths or internal errors
  if (/\/[a-z_-]+\.[a-z]+:/i.test(raw) && raw.length > 120) return "An unexpected error occurred.";
  // Truncate overly long messages
  return raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      credentials: "include",
      signal: controller.signal,
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
      throw new Error(sanitizeApiError(errorMessage));
    }
    if (!isJson) {
      throw new Error(`Expected JSON response, got ${contentType || "unknown content-type"}`);
    }
    const json = await readJsonSafe(res);
    if (!json) {
      throw new Error("Failed to parse JSON response");
    }
    return json.data ?? json;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestRaw<T>(path: string, options?: RequestInit): Promise<ApiEnvelope<T>> {
  const timezone = getBrowserTimezone();
  const csrfToken = getCsrfToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      credentials: "include",
      signal: controller.signal,
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
      const errorMessage = body?.error?.message || body?.error || `HTTP ${res.status}`;
      throw new Error(sanitizeApiError(errorMessage));
    }
    if (!isJson) {
      throw new Error(`Expected JSON response, got ${contentType || "unknown content-type"}`);
    }
    const json = await readJsonSafe(res);
    if (!json) {
      throw new Error("Failed to parse JSON response");
    }
    return json as ApiEnvelope<T>;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cacheKey(prefix: string, payload: unknown) {
  return `${prefix}:${JSON.stringify(payload)}`;
}

function pruneTimedCache<T extends { expiresAt: number }>(cache: Map<string, T>, maxEntries: number, now = Date.now()) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  if (cache.size <= maxEntries) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const excess = entries.length - maxEntries;
  for (const [key] of entries.slice(0, excess)) {
    cache.delete(key);
  }
}

function clearProviderDiscoveryCaches() {
  modelListCache.clear();
  providerCapabilitiesCache.clear();
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
  getThreadMemoryInsights: (
    threadId: string,
    params?: {
      limit?: number;
      category?: ThreadMemoryInsightDto["category"] | "all";
      groupBy?: "none" | "category";
    },
  ) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.category && params.category !== "all") qs.set("category", params.category);
    if (params?.groupBy && params.groupBy !== "none") qs.set("groupBy", params.groupBy);
    return request<ThreadMemoryInsightDto[]>(`/api/chat/threads/${threadId}/memory-insights${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  getThreadMemoryInsightsEnvelope: async (
    threadId: string,
    params?: {
      limit?: number;
      category?: ThreadMemoryInsightDto["category"] | "all";
      groupBy?: "none" | "category";
    },
  ): Promise<{ data: ThreadMemoryInsightDto[]; meta?: ThreadMemoryInsightsMetaDto }> => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.category && params.category !== "all") qs.set("category", params.category);
    if (params?.groupBy && params.groupBy !== "none") qs.set("groupBy", params.groupBy);
    const envelope = await requestRaw<ThreadMemoryInsightDto[]>(`/api/chat/threads/${threadId}/memory-insights${qs.toString() ? `?${qs.toString()}` : ""}`);
    return {
      data: Array.isArray(envelope.data) ? envelope.data : [],
      meta: envelope.meta as ThreadMemoryInsightsMetaDto | undefined,
    };
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

// ─── Recommendations ────────────────────────────────────────────────────────
export const recommendationsApi = {
  getSimilarWorkflows: (workflowId: string, params?: { limit?: number; minScore?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (typeof params?.minScore === "number") qs.set("minScore", String(params.minScore));
    return request<Array<{
      workflowId: string;
      key: string;
      name: string;
      description?: string | null;
      provider: string;
      similarity: number;
    }>>(`/api/recommendations/workflows/${workflowId}${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  getRelatedRuns: (runId: string, params?: { limit?: number; minScore?: number; onlyFailures?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (typeof params?.minScore === "number") qs.set("minScore", String(params.minScore));
    if (typeof params?.onlyFailures === "boolean") qs.set("onlyFailures", String(params.onlyFailures));
    return request<Array<{
      runId: string;
      workflowId: string;
      workflowKey: string;
      status: string;
      startedAt: string;
      similarity: number;
    }>>(`/api/recommendations/runs/${runId}${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  getRelatedDocumentChunks: (attachmentId: string, params?: { limit?: number; minScore?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (typeof params?.minScore === "number") qs.set("minScore", String(params.minScore));
    return request<Array<{
      chunkId: string;
      attachmentId: string;
      filename: string;
      chunkIndex: number;
      content: string;
      similarity: number;
    }>>(`/api/recommendations/documents/${attachmentId}${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
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
export type MfaStatus = MfaStatusDto;
export type TotpSetup = TotpSetupDto;
/**
  * runtime preferences type alias.
  */
export type RuntimePreferences = RuntimePreferencesDto;
export type RetrievalPreferences = RetrievalPreferencesDto;
export type ProviderModelCapabilities = Array<{
  providerConfigId: string;
  provider: string;
  connectionName: string;
  isDefault: boolean;
  configuredModel: string | null;
  status: "ok" | "error";
  error?: string;
  models: Array<{
    id: string;
    name: string;
    provider: string;
    contextWindow: number | null;
    outputTokenLimit?: number | null;
    raw?: Record<string, unknown>;
  }>;
}>;
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
    requestRaw<{ user?: SafeUserDto; mfaRequired?: boolean; method?: "totp" }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  verifyTotp: (payload: { code: string }) =>
    request<{ user: SafeUserDto }>("/api/auth/mfa/totp/verify", {
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
  getMfaStatus: () => request<MfaStatus>("/api/auth/account/mfa"),
  beginTotpSetup: () =>
    request<TotpSetup>("/api/auth/account/mfa/totp/setup", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  enableTotp: (payload: { code: string }) =>
    request<MfaStatus>("/api/auth/account/mfa/totp/enable", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  disableTotp: (payload: { code: string; currentPassword?: string }) =>
    request<MfaStatus>("/api/auth/account/mfa/totp/disable", {
      method: "POST",
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
  getRetrievalPreferences: () => request<RetrievalPreferencesDto>("/api/settings/retrieval-preferences"),
  updateRetrievalPreferences: (payload: Partial<RetrievalPreferencesDto>) =>
    request<RetrievalPreferencesDto>("/api/settings/retrieval-preferences", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getProviderModelCapabilities: (options?: { embeddingOnly?: boolean }) => {
    const qs = new URLSearchParams();
    if (options?.embeddingOnly) qs.set("embeddingOnly", "true");
    const key = cacheKey("provider-capabilities", { embeddingOnly: Boolean(options?.embeddingOnly) });
    pruneTimedCache(providerCapabilitiesCache, MODEL_DISCOVERY_CACHE_MAX_ENTRIES);
    const cached = providerCapabilitiesCache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.value);
    }
    return request<ProviderModelCapabilities>(`/api/settings/providers/model-capabilities${qs.toString() ? `?${qs.toString()}` : ""}`)
      .then((value) => {
        providerCapabilitiesCache.set(key, { expiresAt: now + MODEL_DISCOVERY_CACHE_TTL_MS, value });
        pruneTimedCache(providerCapabilitiesCache, MODEL_DISCOVERY_CACHE_MAX_ENTRIES, now);
        return value;
      });
  },
  saveProviderConfig: (payload: { provider: string; model: string; apiKey?: string; baseUrl?: string; customName?: string }) =>
    request<ProviderConfigDto>("/api/settings/providers", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((value) => {
      clearProviderDiscoveryCaches();
      return value;
    }),
  deleteProvider: (id: string) =>
    request<ProviderConfigDto>(`/api/settings/providers/${id}`, { method: "DELETE" }).then((value) => {
      clearProviderDiscoveryCaches();
      return value;
    }),
  setActiveProvider: (id: string) =>
    request<ProviderConfigDto>(`/api/settings/providers/${id}/active`, { method: "POST" }).then((value) => {
      clearProviderDiscoveryCaches();
      return value;
    }),
  updateProviderModel: (id: string, model: string) =>
    request<ProviderConfigDto>(`/api/settings/providers/${id}/model`, {
      method: "PATCH",
      body: JSON.stringify({ model }),
    }).then((value) => {
      clearProviderDiscoveryCaches();
      return value;
    }),
  fetchModels: (payload: { provider: string; providerId?: string; baseUrl?: string }) => {
    const normalizedPayload = {
      provider: payload.provider,
      providerId: payload.providerId || "",
      baseUrl: payload.baseUrl || "",
    };
    const key = cacheKey("fetch-models", normalizedPayload);
    pruneTimedCache(modelListCache, MODEL_DISCOVERY_CACHE_MAX_ENTRIES);
    const cached = modelListCache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.value);
    }
    return request<string[]>("/api/settings/fetch-models", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((value) => {
      modelListCache.set(key, { expiresAt: now + MODEL_DISCOVERY_CACHE_TTL_MS, value });
      pruneTimedCache(modelListCache, MODEL_DISCOVERY_CACHE_MAX_ENTRIES, now);
      return value;
    });
  },
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
