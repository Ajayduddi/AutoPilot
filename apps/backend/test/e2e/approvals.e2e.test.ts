import { afterEach, describe, expect, it } from "bun:test";
import { approvalsRouter } from "../../src/routes/approvals.routes";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { ApprovalRepo } from "../../src/repositories/approval.repo";
import { WorkflowService } from "../../src/services/workflow.service";

afterEach(() => {
  restoreMocks();
});

describe("Approvals API Endpoints (/api/approvals)", () => {
  it("GET / - returns 200 with list of approvals", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/approvals", approvalsRouter);

    (ApprovalRepo as any).getPendingApprovals = async () => [
      { id: "apprv_1", status: "pending", runId: "run_1" }
    ];

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/approvals`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.data.length).toBe(1);
      expect(json.data[0].id).toBe("apprv_1");
    } finally {
      await server.close();
    }
  });

  it("POST /:id/resolve - successfully resolves approval", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/approvals", approvalsRouter);

    (ApprovalRepo as any).resolveApproval = async () => ({ id: "apprv_1", status: "approved", runId: "run_1" });

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/approvals/apprv_1/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
    } finally {
      await server.close();
    }
  });
});
