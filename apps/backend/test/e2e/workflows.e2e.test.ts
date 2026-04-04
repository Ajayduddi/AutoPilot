import { afterEach, describe, expect, it } from "bun:test";
import { workflowsRouter } from "../../src/routes/workflows.routes";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { WorkflowService } from "../../src/services/workflow.service";

afterEach(() => {
  restoreMocks();
});

describe("Workflows API Endpoints (/api/workflows)", () => {
  it("POST /:id/trigger - executes workflow and returns 202 accepted", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/workflows", workflowsRouter);

    (WorkflowService as any).getById = async () => ({
      id: "wf_1",
      key: "wf_portfolio",
      provider: "n8n",
      enabled: true,
      archived: false,
      executionEndpoint: "http://localhost:5678/webhook/test",
      userId: "usr_test",
    });
    (WorkflowService as any).execute = async () => ({
      id: "run_1",
      status: "queued",
      startedAt: new Date().toISOString(),
    });

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/workflows/wf_1/trigger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "ui", input: {} }),
      });
      expect(res.status).toBe(202);
      const json = await res.json() as any;
      expect(json.status).toBe("accepted");
      expect(json.data.runId).toBe("run_1");
    } finally {
      await server.close();
    }
  });

  it("POST /:id/trigger - returns 404 if workflow doesn't exist", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/workflows", workflowsRouter);

    (WorkflowService as any).getById = async () => undefined;

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/workflows/wf_999/trigger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "ui" }),
      });
      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error.code).toBe("NOT_FOUND");
    } finally {
      await server.close();
    }
  });

  it("POST /:id/trigger - returns 400 if workflow is disabled", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/workflows", workflowsRouter);

    (WorkflowService as any).getById = async () => ({
      id: "wf_1",
      enabled: false,
      userId: "usr_test",
    });

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/workflows/wf_1/trigger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "ui" }),
      });
      expect(res.status).toBe(422);
      const json = await res.json() as any;
      expect(json.error.code).toBe("INVALID_STATE");
    } finally {
      await server.close();
    }
  });
});
