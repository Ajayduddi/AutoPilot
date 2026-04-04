import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { approvalsApi, authApi, chatApi, settingsApi, workflowsApi } from "../../src/lib/api";

const originalFetch = globalThis.fetch;
const originalDocument = (globalThis as any).document;

type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

let fetchCalls: FetchCall[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchCalls = [];
  (globalThis as any).document = {
    cookie: "ap_csrf=csrf_token_999",
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).document = originalDocument;
});

describe("api endpoint wrappers", () => {
  it("sends auth account mutations with correct methods and payloads", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { user: { id: "u1" } } });
    }) as typeof fetch;

    await authApi.updateProfile({ name: "Ajay", timezone: "Asia/Kolkata" });
    await authApi.updateEmail({ email: "ajay@example.com", currentPassword: "old-pass" });
    await authApi.updatePassword({ currentPassword: "old-pass", newPassword: "new-pass" });
    await authApi.logout();

    expect(fetchCalls.length).toBe(4);
    expect(String(fetchCalls[0]?.input)).toContain("/api/auth/account/profile");
    expect(fetchCalls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      name: "Ajay",
      timezone: "Asia/Kolkata",
    });

    expect(String(fetchCalls[1]?.input)).toContain("/api/auth/account/email");
    expect(fetchCalls[1]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchCalls[1]?.init?.body))).toEqual({
      email: "ajay@example.com",
      currentPassword: "old-pass",
    });

    expect(String(fetchCalls[2]?.input)).toContain("/api/auth/account/password");
    expect(fetchCalls[2]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchCalls[2]?.init?.body))).toEqual({
      currentPassword: "old-pass",
      newPassword: "new-pass",
    });

    expect(String(fetchCalls[3]?.input)).toContain("/api/auth/logout");
    expect(fetchCalls[3]?.init?.method).toBe("POST");
  });

  it("builds workflow update/delete/validate/test endpoints correctly", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { ok: true } });
    }) as typeof fetch;

    await workflowsApi.update("wf_1", { name: "Portfolio" });
    await workflowsApi.delete("wf_1", "archive");
    await workflowsApi.delete("wf_2", "hard");
    await workflowsApi.validate("wf_3");
    await workflowsApi.testConnection("https://example.com/webhook");

    expect(String(fetchCalls[0]?.input)).toContain("/api/workflows/wf_1");
    expect(fetchCalls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({ name: "Portfolio" });

    expect(String(fetchCalls[1]?.input)).toContain("/api/workflows/wf_1");
    expect(String(fetchCalls[1]?.input)).not.toContain("?mode=hard");
    expect(fetchCalls[1]?.init?.method).toBe("DELETE");

    expect(String(fetchCalls[2]?.input)).toContain("/api/workflows/wf_2?mode=hard");
    expect(fetchCalls[2]?.init?.method).toBe("DELETE");

    expect(String(fetchCalls[3]?.input)).toContain("/api/workflows/wf_3/validate");
    expect(fetchCalls[3]?.init?.method).toBe("POST");

    expect(String(fetchCalls[4]?.input)).toContain("/api/workflows/test-connection");
    expect(fetchCalls[4]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[4]?.init?.body))).toEqual({
      executionEndpoint: "https://example.com/webhook",
    });
  });

  it("sends settings mutations with proper payloads", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { id: "cfg_1" } });
    }) as typeof fetch;

    await settingsApi.saveProviderConfig({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    });
    await settingsApi.updateProviderModel("cfg_1", "gpt-4o");
    await settingsApi.setActiveProvider("cfg_1");
    await settingsApi.deleteProvider("cfg_1");
    await settingsApi.createWebhookSecret({ label: "ci" });
    await settingsApi.revokeWebhookSecret("wh_1");

    expect(String(fetchCalls[0]?.input)).toContain("/api/settings/providers");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    });

    expect(String(fetchCalls[1]?.input)).toContain("/api/settings/providers/cfg_1/model");
    expect(fetchCalls[1]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchCalls[1]?.init?.body))).toEqual({ model: "gpt-4o" });

    expect(String(fetchCalls[2]?.input)).toContain("/api/settings/providers/cfg_1/active");
    expect(fetchCalls[2]?.init?.method).toBe("POST");

    expect(String(fetchCalls[3]?.input)).toContain("/api/settings/providers/cfg_1");
    expect(fetchCalls[3]?.init?.method).toBe("DELETE");

    expect(String(fetchCalls[4]?.input)).toContain("/api/settings/webhook-secrets");
    expect(fetchCalls[4]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[4]?.init?.body))).toEqual({ label: "ci" });

    expect(String(fetchCalls[5]?.input)).toContain("/api/settings/webhook-secrets/wh_1");
    expect(fetchCalls[5]?.init?.method).toBe("DELETE");
  });

  it("sends approvals resolve and chat mutation endpoints", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { id: "ok" } });
    }) as typeof fetch;

    await approvalsApi.resolve("ap_1", "approved");
    await chatApi.renameThread("thread_1", "Renamed");
    await chatApi.deleteThread("thread_1");
    await chatApi.deleteAllThreads();
    await chatApi.sendClientTelemetry({
      level: "warn",
      category: "stream",
      message: "reconnect",
      metadata: { retryCount: 2 },
    });

    expect(String(fetchCalls[0]?.input)).toContain("/api/approvals/ap_1/resolve");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({ status: "approved" });

    expect(String(fetchCalls[1]?.input)).toContain("/api/chat/threads/thread_1");
    expect(fetchCalls[1]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchCalls[1]?.init?.body))).toEqual({ title: "Renamed" });

    expect(String(fetchCalls[2]?.input)).toContain("/api/chat/threads/thread_1");
    expect(fetchCalls[2]?.init?.method).toBe("DELETE");

    expect(String(fetchCalls[3]?.input)).toContain("/api/chat/threads");
    expect(fetchCalls[3]?.init?.method).toBe("DELETE");

    expect(String(fetchCalls[4]?.input)).toContain("/api/chat/client-telemetry");
    expect(fetchCalls[4]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[4]?.init?.body))).toEqual({
      level: "warn",
      category: "stream",
      message: "reconnect",
      metadata: { retryCount: 2 },
    });
  });
});
