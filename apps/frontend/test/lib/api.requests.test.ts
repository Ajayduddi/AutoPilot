import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chatApi, notificationsApi, settingsApi, workflowsApi } from "../../src/lib/api";

const originalFetch = globalThis.fetch;
const originalDocument = (globalThis as any).document;
const originalIntlDateTimeFormat = Intl.DateTimeFormat;

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
    cookie: "ap_csrf=test_csrf_token%2Bencoded; theme=dark",
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).document = originalDocument;
  Intl.DateTimeFormat = originalIntlDateTimeFormat;
});

describe("api request client", () => {
  it("adds csrf/timezone headers and credentials for standard JSON requests", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: [] });
    }) as typeof fetch;

    await settingsApi.getProviders();

    expect(fetchCalls.length).toBe(1);
    const request = fetchCalls[0]!;
    expect(String(request.input)).toContain("/api/settings/providers");
    expect(request.init?.credentials).toBe("include");
    expect((request.init?.headers as Record<string, string>)?.["x-csrf-token"]).toBe("test_csrf_token+encoded");
    expect((request.init?.headers as Record<string, string>)?.["x-user-timezone"]).toBeTruthy();
    expect((request.init?.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json");
  });

  it("applies query params for list endpoints", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: [] });
    }) as typeof fetch;

    await chatApi.getThreads({ limit: 25, before: "thread_10" });
    await workflowsApi.getAll({ provider: "n8n", enabled: "true", archived: "false", search: "portfolio" });

    expect(String(fetchCalls[0]?.input)).toContain("/api/chat/threads?limit=25&before=thread_10");
    const workflowUrl = String(fetchCalls[1]?.input);
    expect(workflowUrl).toContain("/api/workflows?");
    expect(workflowUrl).toContain("provider=n8n");
    expect(workflowUrl).toContain("enabled=true");
    expect(workflowUrl).toContain("archived=false");
    expect(workflowUrl).toContain("search=portfolio");
  });

  it("builds default attachmentIds payload for sendMessage", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { userMessage: {}, assistantReply: {} } });
    }) as typeof fetch;

    await chatApi.sendMessage("thread_1", "hello", "provider_1", "model_1");

    const body = JSON.parse(String(fetchCalls[0]?.init?.body));
    expect(body.role).toBe("user");
    expect(body.content).toBe("hello");
    expect(body.providerId).toBe("provider_1");
    expect(body.model).toBe("model_1");
    expect(body.attachmentIds).toEqual([]);
  });

  it("unwraps API envelope and surfaces error payload messages", async () => {
    globalThis.fetch = (async () => jsonResponse({ error: "Bad request payload" }, 400)) as typeof fetch;

    let errorMessage = "";
    try {
      await settingsApi.fetchModels({ provider: "gemini" });
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    expect(errorMessage).toBe("Bad request payload");
  });

  it("returns raw json when response has no data envelope", async () => {
    globalThis.fetch = (async () => jsonResponse({ publicKey: "abc123" })) as typeof fetch;

    const payload = await notificationsApi.getPushPublicKey();
    expect(payload).toEqual({ publicKey: "abc123" });
  });

  it("works in non-browser contexts without document cookie or timezone", async () => {
    (globalThis as any).document = undefined;
    Intl.DateTimeFormat = (() => {
      throw new Error("timezone unavailable");
    }) as unknown as typeof Intl.DateTimeFormat;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: [] });
    }) as typeof fetch;

    await settingsApi.getProviders();

    const headers = (fetchCalls[0]?.init?.headers || {}) as Record<string, string>;
    expect(headers["x-csrf-token"]).toBeUndefined();
    expect(headers["x-user-timezone"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
