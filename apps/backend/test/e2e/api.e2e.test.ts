import { afterEach, describe, expect, it } from "bun:test";
import express, { type Express } from "express";
import type { Server } from "http";
import { traceMiddleware } from "../../src/middleware/trace.middleware";
import { authRouter } from "../../src/routes/auth.routes";
import { chatRouter } from "../../src/routes/chat.routes";
import { webhooksRouter } from "../../src/routes/webhooks.routes";
import { workflowsRouter } from "../../src/routes/workflows.routes";
import { AuthService } from "../../src/services/auth.service";
import { UserRepo } from "../../src/repositories/user.repo";
import { ChatRepo } from "../../src/repositories/chat.repo";
import { ChatService } from "../../src/services/chat.service";
import { OrchestratorService } from "../../src/services/orchestrator.service";
import { AgentService } from "../../src/services/agent.service";
import { WorkflowService } from "../../src/services/workflow.service";
import { NotificationService } from "../../src/services/notification.service";

const original = {
  getByEmail: UserRepo.getByEmail,
  verifyPassword: AuthService.verifyPassword,
  createSessionForUser: AuthService.createSessionForUser,
  logoutByCookie: AuthService.logoutByCookie,
  ensureThread: ChatRepo.ensureThread,
  getAttachmentsByIds: ChatRepo.getAttachmentsByIds,
  addMessage: ChatService.addMessage,
  handleStreamingMessage: OrchestratorService.handleStreamingMessage,
  agentEnabled: AgentService.isEnabled,
  agentStreamingMessage: AgentService.handleStreamingMessage,
  getWorkflowById: WorkflowService.getById,
  executeWorkflow: WorkflowService.execute,
  getRunById: WorkflowService.getRunById,
  updateRunStatus: WorkflowService.updateRunStatus,
  shouldNotifyWorkflowRun: NotificationService.shouldNotifyWorkflowRun,
};

async function withServer(app: Express): Promise<{ baseUrl: string; close: () => Promise<void> } | null> {
  const maxAttempts = 5;
  const tryListen = (attempt = 1): Promise<{ baseUrl: string; close: () => Promise<void> }> =>
    new Promise((resolve, reject) => {
      const port = Math.floor(10_000 + Math.random() * 40_000);
      const server = app.listen(port, () => {
        resolve({
          baseUrl: `http://127.0.0.1:${port}`,
          close: async () =>
            await new Promise<void>((res, rej) =>
              (server as Server).close((err?: Error) => (err ? rej(err) : res())),
            ),
        });
      });

      server.on("error", (err: any) => {
        if (err?.code === "EADDRINUSE" && attempt < maxAttempts) {
          return resolve(tryListen(attempt + 1));
        }
        reject(err);
      });
    });

  try {
    return await tryListen();
  } catch (err: any) {
    if (err?.code === "EADDRINUSE" || err?.code === "EACCES" || err?.code === "EPERM") {
      return null;
    }
    throw err;
  }
}

function buildApp(opts?: { injectAuth?: boolean }) {
  const app = express();
  app.use(express.json());
  app.use(traceMiddleware);
  if (opts?.injectAuth) {
    app.use((req: any, _res, next) => {
      req.auth = { user: { id: "usr_test", email: "test@example.com", name: "Test" } };
      next();
    });
  }
  return app;
}

afterEach(() => {
  (UserRepo as any).getByEmail = original.getByEmail;
  (AuthService as any).verifyPassword = original.verifyPassword;
  (AuthService as any).createSessionForUser = original.createSessionForUser;
  (AuthService as any).logoutByCookie = original.logoutByCookie;
  (ChatRepo as any).ensureThread = original.ensureThread;
  (ChatRepo as any).getAttachmentsByIds = original.getAttachmentsByIds;
  (ChatService as any).addMessage = original.addMessage;
  (OrchestratorService as any).handleStreamingMessage = original.handleStreamingMessage;
  (AgentService as any).isEnabled = original.agentEnabled;
  (AgentService as any).handleStreamingMessage = original.agentStreamingMessage;
  (WorkflowService as any).getById = original.getWorkflowById;
  (WorkflowService as any).execute = original.executeWorkflow;
  (WorkflowService as any).getRunById = original.getRunById;
  (WorkflowService as any).updateRunStatus = original.updateRunStatus;
  (NotificationService as any).shouldNotifyWorkflowRun = original.shouldNotifyWorkflowRun;
});

describe("API e2e integration (real express boot)", () => {
  it("auth lifecycle: login + logout", async () => {
    const app = buildApp();
    app.use("/api/auth", authRouter);

    (UserRepo as any).getByEmail = async () => ({ id: "usr_1", email: "u@test.com", passwordHash: "hash:ok", name: "U" });
    (AuthService as any).verifyPassword = async () => true;
    (AuthService as any).createSessionForUser = async () => "session_token";
    (AuthService as any).logoutByCookie = async () => undefined;

    const server = await withServer(app);
    if (!server) return;
    try {
      const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "u@test.com", password: "password123" }),
      });
      expect(loginRes.status).toBe(200);
      const setCookie = loginRes.headers.get("set-cookie");
      expect(Boolean(setCookie)).toBe(true);

      const logoutRes = await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(setCookie ? { cookie: setCookie } : {}),
        },
      });
      expect(logoutRes.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("chat stream endpoint emits SSE complete event", async () => {
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
    if (!server) return;
    try {
      const res = await fetch(`${server.baseUrl}/api/chat/threads/th_1/messages/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "user", content: "hi" }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("event: complete");
      expect(text).toContain("event: block");
    } finally {
      await server.close();
    }
  });

  it("chat stream falls back to orchestrator when agent provider is unavailable", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/chat", chatRouter);

    (AgentService as any).isEnabled = () => true;
    (AgentService as any).handleStreamingMessage = async () => {
      throw new Error("Provider outage: agent model unavailable");
    };
    (ChatRepo as any).ensureThread = async () => ({ id: "th_2", userId: "usr_test" });
    (ChatRepo as any).getAttachmentsByIds = async () => [];
    (ChatService as any).addMessage = async (_threadId: string, role: string) => ({
      id: role === "user" ? "msg_user_2" : "msg_assistant_2",
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
      callbacks.onBlock(0, { type: "markdown", text: "Fallback answer" });
      callbacks.onChunk(0, " after outage");
      callbacks.onBlockEnd(0);
      return { id: "msg_asst_fallback", createdAt: new Date().toISOString() };
    };

    const server = await withServer(app);
    if (!server) return;
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

  it("chat stream emits error event when all providers fail during streaming", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/chat", chatRouter);

    (AgentService as any).isEnabled = () => false;
    (ChatRepo as any).ensureThread = async () => ({ id: "th_3", userId: "usr_test" });
    (ChatRepo as any).getAttachmentsByIds = async () => [];
    (ChatService as any).addMessage = async (_threadId: string, role: string) => ({
      id: role === "user" ? "msg_user_3" : "msg_assistant_3",
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
      callbacks.onBlock(0, { type: "markdown", text: "partial" });
      callbacks.onChunk(0, " response");
      throw new Error("Provider outage: orchestrator failed after partial stream");
    };

    const server = await withServer(app);
    if (!server) return;
    try {
      const res = await fetch(`${server.baseUrl}/api/chat/threads/th_3/messages/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "user", content: "force streaming error" }),
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

  it("webhook callback endpoint processes valid secret", async () => {
    process.env.WEBHOOK_CALLBACK_SECRET = "secret_abc";
    const app = buildApp();
    app.use("/api/webhooks", webhooksRouter);

    (WorkflowService as any).getRunById = async () => ({
      id: "run_1",
      userId: "usr_1",
      threadId: null,
      triggerSource: "system",
      workflowKey: "wf_portfolio",
      provider: "n8n",
      traceId: "tr_1",
    });
    (WorkflowService as any).updateRunStatus = async () => undefined;
    (NotificationService as any).shouldNotifyWorkflowRun = () => false;

    const server = await withServer(app);
    if (!server) return;
    try {
      const res = await fetch(`${server.baseUrl}/api/webhooks/n8n`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": "secret_abc",
        },
        body: JSON.stringify({ type: "completed", runId: "run_1", result: { ok: true } }),
      });
      expect(res.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("workflow trigger endpoint executes and returns accepted payload", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/workflows", workflowsRouter);

    (WorkflowService as any).getById = async () => ({
      id: "wf_1",
      key: "wf_portfolio",
      provider: "n8n",
      enabled: true,
      archived: false,
      executionEndpoint: "http://localhost:5678/webhook/test",
    });
    (WorkflowService as any).execute = async () => ({
      id: "run_1",
      status: "queued",
      startedAt: new Date().toISOString(),
    });

    const server = await withServer(app);
    if (!server) return;
    try {
      const res = await fetch(`${server.baseUrl}/api/workflows/wf_1/trigger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "ui", input: {} }),
      });
      expect(res.status).toBe(202);
      const json: any = await res.json();
      expect(json?.data?.runId).toBe("run_1");
      expect(json?.status).toBe("accepted");
    } finally {
      await server.close();
    }
  });
});
