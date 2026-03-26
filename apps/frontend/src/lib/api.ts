// Central API client for the AutoPilot backend
// Base URL: defaults to localhost in dev, can be overridden via VITE_API_URL

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

// ─── SSE stream parser ────────────────────────────────────────────────────────

export type SseEvent = { event: string; data: any };

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

export const chatApi = {
  getThreads: () => request<any[]>("/api/chat/threads"),

  createThread: (title?: string) =>
    request<any>("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({ title: title || "New Thread" }),
    }),

  getMessages: (threadId: string) =>
    request<any[]>(`/api/chat/threads/${threadId}/messages`),

  /** Legacy non-streaming send — kept as fallback */
  sendMessage: (threadId: string, content: string, providerId?: string, model?: string) =>
    request<{ userMessage: any; assistantReply: any }>(
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ role: "user", content, providerId, model }),
      }
    ),

  /** Streaming send — yields SSE events as they arrive from the backend. */
  async *sendMessageStream(
    threadId: string,
    content: string,
    providerId?: string,
    model?: string,
  ): AsyncGenerator<SseEvent> {
    const response = await fetch(`${BASE_URL}/api/chat/threads/${threadId}/messages/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content, providerId, model }),
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    yield* parseSseStream(response);
  },

  renameThread: (threadId: string, title: string) =>
    request<any>(`/api/chat/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteThread: (threadId: string) =>
    request<any>(`/api/chat/threads/${threadId}`, { method: "DELETE" }),

  deleteAllThreads: () =>
    request<any>(`/api/chat/threads`, { method: "DELETE" }),
};

// ─── Workflows ───────────────────────────────────────────────────────────────

export const workflowsApi = {
  getAll: (filters?: { provider?: string; visibility?: string; enabled?: string; archived?: string; search?: string }) => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    }
    const qs = params.toString();
    return request<any[]>(`/api/workflows${qs ? `?${qs}` : ""}`);
  },

  getById: (id: string) => request<any>(`/api/workflows/${id}`),

  create: (data: any) =>
    request<any>("/api/workflows", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: any) =>
    request<any>(`/api/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string, mode?: "hard" | "archive") =>
    request<any>(`/api/workflows/${id}${mode === "hard" ? "?mode=hard" : ""}`, {
      method: "DELETE",
    }),

  trigger: (id: string, payload?: { source?: string; input?: any }) =>
    request<any>(`/api/workflows/${id}/trigger`, {
      method: "POST",
      body: JSON.stringify(payload || { source: "ui", input: {} }),
    }),

  getRuns: (workflowId: string, limit?: number) =>
    request<any[]>(`/api/workflows/${workflowId}/runs${limit ? `?limit=${limit}` : ""}`),

  getRunById: (runId: string, includeRaw?: boolean) =>
    request<any>(`/api/workflow-runs/${runId}${includeRaw ? "?includeRaw=true" : ""}`),

  validate: (id: string) =>
    request<any>(`/api/workflows/${id}/validate`, { method: "POST" }),

  testConnection: (executionEndpoint: string) =>
    request<any>("/api/workflows/test-connection", {
      method: "POST",
      body: JSON.stringify({ executionEndpoint }),
    }),
};

// ─── Approvals ───────────────────────────────────────────────────────────────

export const approvalsApi = {
  getPending: () => request<any[]>("/api/approvals"),

  resolve: (id: string, status: "approved" | "rejected") =>
    request<any>(`/api/approvals/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
};

// ─── Notifications ───────────────────────────────────────────────────────────

export const notificationsApi = {
  getAll: () => request<any[]>("/api/notifications"),

  markRead: (id: string) =>
    request<any>(`/api/notifications/${id}/read`, { method: "POST" }),

  /** Returns an EventSource — subscribe to real-time events from the server */
  openStream: () => new EventSource(`${BASE_URL}/api/notifications/stream`),
};

// ─── Settings ────────────────────────────────────────────────────────────────

export const settingsApi = {
  getProviders: () => request<any[]>("/api/settings/providers"),

  saveProviderConfig: (payload: { provider: string; model: string; apiKey?: string; baseUrl?: string }) =>
    request<any>("/api/settings/providers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteProvider: (id: string) =>
    request<any>(`/api/settings/providers/${id}`, { method: "DELETE" }),

  setActiveProvider: (id: string) =>
    request<any>(`/api/settings/providers/${id}/active`, { method: "POST" }),

  fetchModels: (payload: { provider: string; baseUrl?: string; apiKey?: string }) =>
    request<string[]>("/api/settings/fetch-models", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
