import { afterEach, describe, expect, it } from "bun:test";
import { webhooksRouter } from "../../src/routes/webhooks.routes";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { WorkflowService } from "../../src/services/workflow.service";
import { NotificationService } from "../../src/services/notification.service";

afterEach(() => {
  restoreMocks();
});

describe("Webhooks API Endpoints (/api/webhooks)", () => {
  it("POST /n8n - processes valid secret from env", async () => {
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
      delete process.env.WEBHOOK_CALLBACK_SECRET;
    }
  });

  it("POST /n8n - rejects invalid secret with 401", async () => {
    process.env.WEBHOOK_CALLBACK_SECRET = "secret_abc";
    const app = buildApp();
    app.use("/api/webhooks", webhooksRouter);

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/webhooks/n8n`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": "wrong_secret",
        },
        body: JSON.stringify({ type: "completed", runId: "run_1" }),
      });
      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.error.code).toBe("UNAUTHORIZED");
    } finally {
      await server.close();
      delete process.env.WEBHOOK_CALLBACK_SECRET;
    }
  });

  it("POST /n8n - rejects missing payload with 400", async () => {
    process.env.WEBHOOK_CALLBACK_SECRET = "secret_abc";
    const app = buildApp();
    app.use("/api/webhooks", webhooksRouter);

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/webhooks/n8n`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": "secret_abc",
        },
        // missing type/runId
        body: JSON.stringify({ result: { ok: true } }),
      });
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    } finally {
      await server.close();
      delete process.env.WEBHOOK_CALLBACK_SECRET;
    }
  });
});
