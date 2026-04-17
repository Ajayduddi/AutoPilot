/**
 * @fileoverview End-to-end tests for chat route behavior, request validation,
 * and streaming-safe response contracts.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { chatRouter } from "../../src/routes/chat.routes";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { ChatRepo } from "../../src/repositories/chat.repo";
import { ChatService } from "../../src/services/chat.service";
import { OrchestratorService } from "../../src/services/orchestrator/orchestrator.service";
import { AgentService } from "../../src/services/agent/agent.service";
import { TemporalService } from "../../src/services/temporal.service";

afterEach(() => {
  restoreMocks();
});

describe("Chat API Endpoints (/api/chat)", () => {
  describe("SSE Streaming Endpoint", () => {
    it("POST /threads/:id/messages/stream - emits SSE complete event", async () => {
      const app = buildApp({ injectAuth: true });
      app.use("/api/chat", chatRouter);

      (AgentService as any).isEnabled = () => false;
      (ChatRepo as any).ensureThread = async () => ({ id: "th_1", userId: "usr_test" });
      (ChatRepo as any).getAttachmentsByIds = async () => [];
      (ChatService as any).addMessage = async (_threadId: string, role: string) => ({
        id: role === "user" ? "msg_user" : "msg_assistant",
        role,
        createdAt: new Date().toISOString(),
      });
      (OrchestratorService as any).handleStreamingMessage = async (
        _threadId: string,
        _content: string,
        _traceId: string,
        _userId: string,
        _providerId: string | undefined,
        _model: string | undefined,
        _attachments: any[],
        callbacks: any,
      ) => {
        callbacks.onBlock(0, { type: "markdown", text: "Hello" });
        callbacks.onChunk(0, " world");
        callbacks.onBlockEnd(0);
        return { id: "msg_asst_1", createdAt: new Date().toISOString() };
      };

      const server = await withServer(app);
      try {
        const res = await fetch(`${server.baseUrl}/api/chat/threads/th_1/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "user", content: "hi" }),
        });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("event: block");
        expect(text).toContain("data: {\"index\":0,\"block\":{\"type\":\"markdown\",\"text\":\"Hello\"}}");
        expect(text).toContain("event: block_end");
        expect(text).toContain("event: complete");
        expect(text).toContain("data: {\"messageId\":\"msg_asst_1\"");
      } finally {
        await server.close();
      }
    });

    it("POST /threads/:id/messages/stream - falls back to orchestrator when agent fails", async () => {
      const app = buildApp({ injectAuth: true });
      app.use("/api/chat", chatRouter);

      (AgentService as any).isEnabled = () => true;
      (AgentService as any).handleStreamingMessage = async () => {
        throw new Error("Provider outage");
      };
      (ChatRepo as any).ensureThread = async () => ({ id: "th_2", userId: "usr_test" });
      (ChatRepo as any).getAttachmentsByIds = async () => [];
      (ChatService as any).addMessage = async (_threadId: string, role: string) => ({
        id: role === "user" ? "msg_user_2" : "msg_assistant_2",
        role,
        createdAt: new Date().toISOString(),
      });
      (OrchestratorService as any).handleStreamingMessage = async (
        _th, _co, _tr, _us, _pr, _mo, _at, callbacks: any,
      ) => {
        callbacks.onBlock(0, { type: "markdown", text: "Fallback answer" });
        return { id: "msg_asst_fallback", createdAt: new Date().toISOString() };
      };

      const server = await withServer(app);
      try {
        const res = await fetch(`${server.baseUrl}/api/chat/threads/th_2/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "user", content: "hi with outage" }),
        });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("Fallback answer");
        expect(text).toContain("event: complete");
        expect(text).not.toContain("event: error");
      } finally {
        await server.close();
      }
    });

    it("POST /threads/:id/messages/stream - emits error event when orchestrator fails", async () => {
      const app = buildApp({ injectAuth: true });
      app.use("/api/chat", chatRouter);

      (AgentService as any).isEnabled = () => false;
      (ChatRepo as any).ensureThread = async () => ({ id: "th_3", userId: "usr_test" });
      (ChatRepo as any).getAttachmentsByIds = async () => [];
      (ChatService as any).addMessage = async () => ({ id: "msg_user_3", role: "user" });
      (OrchestratorService as any).handleStreamingMessage = async (
        _th, _co, _tr, _us, _pr, _mo, _at, callbacks: any,
      ) => {
        callbacks.onBlock(0, { type: "markdown", text: "partial" });
        throw new Error("Provider outage: orchestrator failed after partial stream");
      };

      const server = await withServer(app);
      try {
        const res = await fetch(`${server.baseUrl}/api/chat/threads/th_3/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "user", content: "force errors" }),
        });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("event: block");
        expect(text).toContain("event: error");
        expect(text).not.toContain("event: complete");
      } finally {
        await server.close();
      }
    });
  });

  describe("Non-streaming Endpoint", () => {
    it("POST /threads/:id/messages - preserves deterministic current date for Jan 2025 to Present follow-up", async () => {
      const app = buildApp({ injectAuth: true });
      app.use("/api/chat", chatRouter);

      (AgentService as any).isEnabled = () => false;
      (ChatRepo as any).ensureThread = async () => ({ id: "th_present", userId: "usr_test" });
      (ChatRepo as any).getAttachmentsByIds = async () => [];
      (ChatRepo as any).linkAttachmentsToMessage = async () => {};

      let addMessageCallCount = 0;
      (ChatService as any).addMessage = async (_threadId: string, role: string, content?: string, extra?: any) => {
        addMessageCallCount += 1;
        return {
          id: role === "user" ? `msg_user_${addMessageCallCount}` : `msg_assistant_${addMessageCallCount}`,
          role,
          content,
          blocks: extra?.blocks,
          createdAt: new Date().toISOString(),
        };
      };

      (OrchestratorService as any).handleIncomingMessage = async (
        _threadId: string,
        _content: string,
        _traceId: string,
        _userId: string,
        _providerId: string | undefined,
        _model: string | undefined,
        _attachments: any[],
        temporalInput: any,
      ) => {
        const clock = TemporalService.buildRuntimeClockContext(temporalInput || {});
        return {
          id: "msg_assistant_present",
          role: "assistant",
          content: `CodeTantra: Jan 2025 - Present\nCurrent grounded date: ${clock.iso}`,
          blocks: [
            { type: "summary", items: ["Answered from deterministic runtime date."] },
            { type: "markdown", text: `CodeTantra: Jan 2025 - Present\nCurrent grounded date: ${clock.iso}` },
          ],
          createdAt: new Date().toISOString(),
        };
      };

      const server = await withServer(app);
      try {
        const res = await fetch(`${server.baseUrl}/api/chat/threads/th_present/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-timezone": "Asia/Kolkata",
          },
          body: JSON.stringify({
            role: "user",
            content: "i was join in codetantra in jan 2025. how much experience do i have now?",
          }),
        });
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.data.assistantReply.content).toContain("Jan 2025 - Present");
        expect(json.data.assistantReply.content).toContain("Current grounded date:");
        expect(json.data.assistantReply.content).toContain(new Date().getUTCFullYear().toString());
      } finally {
        await server.close();
      }
    });
  });
});
