import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  approvalsApi,
  authApi,
  notificationsApi,
  settingsApi,
  workflowsApi,
} from "../../src/lib/api";

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
  (globalThis as any).document = { cookie: "ap_csrf=csrf_abc" };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).document = originalDocument;
});

describe("api remaining wrappers", () => {
  it("builds workflow run history/read URLs correctly", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: [] });
    }) as typeof fetch;

    await workflowsApi.getRuns("wf_1", { limit: 20, before: "run_100" });
    await workflowsApi.getRunById("run_1");
    await workflowsApi.getRunById("run_2", true);

    expect(String(fetchCalls[0]?.input)).toContain("/api/workflows/wf_1/runs?limit=20&before=run_100");
    expect(String(fetchCalls[1]?.input)).toContain("/api/workflow-runs/run_1");
    expect(String(fetchCalls[1]?.input)).not.toContain("includeRaw=true");
    expect(String(fetchCalls[2]?.input)).toContain("/api/workflow-runs/run_2?includeRaw=true");
  });

  it("covers notification CRUD and push endpoints", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { ok: true } });
    }) as typeof fetch;

    await notificationsApi.getAll({ limit: 15, before: "n_10" });
    await notificationsApi.markRead("n_1");
    await notificationsApi.clearAll();
    await notificationsApi.getPushPublicKey();
    await notificationsApi.subscribePush({ endpoint: "https://push.test/e1" });
    await notificationsApi.unsubscribePush("https://push.test/e1");
    await notificationsApi.sendPushTest();

    expect(String(fetchCalls[0]?.input)).toContain("/api/notifications?limit=15&before=n_10");
    expect(String(fetchCalls[1]?.input)).toContain("/api/notifications/n_1/read");
    expect(fetchCalls[1]?.init?.method).toBe("POST");
    expect(String(fetchCalls[2]?.input)).toContain("/api/notifications");
    expect(fetchCalls[2]?.init?.method).toBe("DELETE");
    expect(String(fetchCalls[3]?.input)).toContain("/api/notifications/push/public-key");
    expect(String(fetchCalls[4]?.input)).toContain("/api/notifications/push/subscribe");
    expect(JSON.parse(String(fetchCalls[4]?.init?.body))).toEqual({ endpoint: "https://push.test/e1" });
    expect(String(fetchCalls[5]?.input)).toContain("/api/notifications/push/unsubscribe");
    expect(JSON.parse(String(fetchCalls[5]?.init?.body))).toEqual({ endpoint: "https://push.test/e1" });
    expect(String(fetchCalls[6]?.input)).toContain("/api/notifications/push/test");
  });

  it("covers auth read/login/register endpoints and google start URL", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { ok: true } });
    }) as typeof fetch;

    await authApi.getState();
    await authApi.getMe();
    await authApi.getAccount();
    await authApi.registerOnboarding({ email: "user@example.com", name: "User", password: "secret123" });
    await authApi.login({ email: "user@example.com", password: "secret123" });

    expect(String(fetchCalls[0]?.input)).toContain("/api/auth/state");
    expect(String(fetchCalls[1]?.input)).toContain("/api/auth/me");
    expect(String(fetchCalls[2]?.input)).toContain("/api/auth/account");
    expect(String(fetchCalls[3]?.input)).toContain("/api/auth/onboarding/register");
    expect(fetchCalls[3]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[3]?.init?.body))).toEqual({
      email: "user@example.com",
      name: "User",
      password: "secret123",
    });
    expect(String(fetchCalls[4]?.input)).toContain("/api/auth/login");
    expect(fetchCalls[4]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[4]?.init?.body))).toEqual({
      email: "user@example.com",
      password: "secret123",
    });

    expect(authApi.googleStartUrl()).toContain("/api/auth/google/start");
  });

  it("covers settings read/update/fetch-models/webhook-list and approvals list", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: [] });
    }) as typeof fetch;

    await settingsApi.getProviders();
    await settingsApi.getRuntimePreferences();
    await settingsApi.updateRuntimePreferences({ defaultModel: "gpt-4o-mini" } as any);
    await settingsApi.fetchModels({
      provider: "ollama",
      providerId: "p_1",
      baseUrl: "http://localhost:11434",
      apiKey: "sk-local",
    });
    await settingsApi.getWebhookSecrets();
    await approvalsApi.getPending();

    expect(String(fetchCalls[0]?.input)).toContain("/api/settings/providers");
    expect(String(fetchCalls[1]?.input)).toContain("/api/settings/runtime-preferences");
    expect(String(fetchCalls[2]?.input)).toContain("/api/settings/runtime-preferences");
    expect(fetchCalls[2]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchCalls[2]?.init?.body))).toEqual({ defaultModel: "gpt-4o-mini" });
    expect(String(fetchCalls[3]?.input)).toContain("/api/settings/fetch-models");
    expect(fetchCalls[3]?.init?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[3]?.init?.body))).toEqual({
      provider: "ollama",
      providerId: "p_1",
      baseUrl: "http://localhost:11434",
      apiKey: "sk-local",
    });
    expect(String(fetchCalls[4]?.input)).toContain("/api/settings/webhook-secrets");
    expect(String(fetchCalls[5]?.input)).toContain("/api/approvals");
  });
});
