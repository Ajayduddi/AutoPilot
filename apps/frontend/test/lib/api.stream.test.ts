import { afterEach, describe, expect, it } from "bun:test";
import { chatApi } from "../../src/lib/api";

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

function sseResponse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("api/sendMessageStream", () => {
  it("parses SSE events and ignores malformed payloads/comments", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        ": ping\n\n",
        'event: start\ndata: {"step":"intent"}\n\n',
        'event: token\ndata: {"chunk":"Hel"}\n\n',
        'event: token\ndata: not-json\n\n',
        'event: token\ndata: {"chunk":"lo"}\n\n',
        'event: complete\ndata: {"ok":true}\n\n',
      ])) as typeof fetch;

    const events: Array<{ event: string; data: unknown }> = [];
    for await (const event of chatApi.sendMessageStream("thread_1", "hello", "prov", "model_1")) {
      events.push(event);
    }

    expect(events.map((event) => event.event)).toEqual(["start", "token", "token", "complete"]);
    expect(events[0]?.data).toEqual({ step: "intent" });
    expect(events[3]?.data).toEqual({ ok: true });
  });

  it("parses events when SSE frames are split across arbitrary chunks", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        "event: token\n",
        'data: {"chunk":"He',
        'llo"}\n\n',
        "event: complete\n",
        'data: {"done":true}\n\n',
      ])) as typeof fetch;

    const events: Array<{ event: string; data: unknown }> = [];
    for await (const event of chatApi.sendMessageStream("thread_split", "hello")) {
      events.push(event);
    }

    expect(events).toEqual([
      { event: "token", data: { chunk: "Hello" } },
      { event: "complete", data: { done: true } },
    ]);
  });

  it("throws backend error envelope for non-2xx stream responses", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Provider unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    let errorMessage = "";
    try {
      for await (const _event of chatApi.sendMessageStream("thread_2", "hello")) {
        // no-op
      }
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    expect(errorMessage).toBe("Provider unavailable");
  });

  it("throws HTTP fallback when non-2xx stream response lacks JSON error", async () => {
    globalThis.fetch = (async () => new Response("upstream down", { status: 502 })) as typeof fetch;

    let errorMessage = "";
    try {
      for await (const _event of chatApi.sendMessageStream("thread_3", "hello")) {
        // no-op
      }
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    expect(errorMessage).toBe("HTTP 502");
  });
});
