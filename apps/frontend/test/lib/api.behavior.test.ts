import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chatApi, notificationsApi, workflowsApi } from "../../src/lib/api";

const originalFetch = globalThis.fetch;
const originalDocument = (globalThis as any).document;
const originalEventSource = (globalThis as any).EventSource;

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
    cookie: "ap_csrf=token_123; theme=dark",
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).document = originalDocument;
  (globalThis as any).EventSource = originalEventSource;
});

describe("api client behavior", () => {
  it("builds multipart attachment upload with csrf/tz headers and provider/model fields", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: [{ id: "att_1" }] });
    }) as typeof fetch;

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const result = await chatApi.uploadAttachments("thread_1", [file], "provider_1", "model_1");

    expect(result).toEqual([{ id: "att_1" }]);
    const request = fetchCalls[0]!;
    expect(String(request.input)).toContain("/api/chat/attachments");
    expect(request.init?.method).toBe("POST");
    expect(request.init?.credentials).toBe("include");
    expect((request.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("token_123");
    expect((request.init?.headers as Record<string, string>)["x-user-timezone"]).toBeTruthy();
    expect(request.init?.body).toBeInstanceOf(FormData);

    const form = request.init?.body as FormData;
    expect(form.get("threadId")).toBe("thread_1");
    expect(form.get("providerId")).toBe("provider_1");
    expect(form.get("model")).toBe("model_1");
    expect((form.get("files") as File).name).toBe("hello.txt");
  });

  it("surfaces upload attachment errors with message-first fallback", async () => {
    globalThis.fetch = (async () => jsonResponse({ message: "Upload blocked" }, 413)) as typeof fetch;
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    let errorMessage = "";
    try {
      await chatApi.uploadAttachments("thread_1", [file]);
    } catch (error) {
      errorMessage = (error as Error).message;
    }
    expect(errorMessage).toBe("Upload blocked");
  });

  it("uses default trigger payload when none is provided", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { runId: "run_1", workflowId: "wf_1", status: "running" } });
    }) as typeof fetch;

    await workflowsApi.trigger("wf_1");

    const payload = JSON.parse(String(fetchCalls[0]?.init?.body));
    expect(payload).toEqual({ source: "ui", input: {} });
  });

  it("forwards explicit payload for inline question answer requests", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return jsonResponse({ data: { message: { id: "m1" } } });
    }) as typeof fetch;

    await chatApi.answerQuestionInline("thread_7", "msg_1", "q_1", {
      optionId: "opt_2",
      valueToSend: "approve",
      providerId: "provider_7",
      model: "model_x",
    });

    const call = fetchCalls[0]!;
    expect(String(call.input)).toContain("/api/chat/threads/thread_7/messages/msg_1/questions/q_1/answer");
    expect(call.init?.method).toBe("POST");
    expect(JSON.parse(String(call.init?.body))).toEqual({
      optionId: "opt_2",
      valueToSend: "approve",
      providerId: "provider_7",
      model: "model_x",
    });
  });

  it("sends stream request payload with attachment default and optional provider/model", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return new Response('event: complete\ndata: {"ok":true}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    for await (const _event of chatApi.sendMessageStream("thread_payload", "hello world", "prov_1", "model_1")) {
      // exhaust
    }
    for await (const _event of chatApi.sendMessageStream("thread_payload_2", "hello world")) {
      // exhaust
    }

    const payloadA = JSON.parse(String(fetchCalls[0]?.init?.body));
    expect(payloadA).toEqual({
      role: "user",
      content: "hello world",
      providerId: "prov_1",
      model: "model_1",
      attachmentIds: [],
    });

    const payloadB = JSON.parse(String(fetchCalls[1]?.init?.body));
    expect(payloadB.role).toBe("user");
    expect(payloadB.content).toBe("hello world");
    expect(payloadB.attachmentIds).toEqual([]);
    expect("providerId" in payloadB).toBeFalse();
    expect("model" in payloadB).toBeFalse();
  });

  it("opens notification stream with credentials enabled", () => {
    const creations: Array<{ url: string; init?: EventSourceInit }> = [];
    (globalThis as any).EventSource = class {
      constructor(url: string, init?: EventSourceInit) {
        creations.push({ url, init });
      }
    };

    notificationsApi.openStream();

    expect(creations.length).toBe(1);
    expect(creations[0]?.url).toContain("/api/notifications/stream");
    expect(creations[0]?.init?.withCredentials).toBeTrue();
  });
});
