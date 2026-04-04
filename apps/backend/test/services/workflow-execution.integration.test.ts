import { afterEach, describe, expect, it } from "bun:test";
import { WorkflowService } from "../../src/services/workflow.service";
import { WorkflowRepo } from "../../src/repositories/workflow.repo";

describe("WorkflowService execute integration-ish flow", () => {
  const originalCreateRun = WorkflowRepo.createRun;
  const originalDispatch = (WorkflowService as any).dispatchViaAdapter;

  afterEach(() => {
    (WorkflowRepo as any).createRun = originalCreateRun;
    (WorkflowService as any).dispatchViaAdapter = originalDispatch;
  });

  it("creates queued run and dispatches asynchronously", async () => {
    let dispatchCalled = 0;
    (WorkflowRepo as any).createRun = async (payload: any) => ({
      ...payload,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: new Date(),
    });
    (WorkflowService as any).dispatchViaAdapter = () => {
      dispatchCalled += 1;
    };

    const run = await WorkflowService.execute(
      "wf-id",
      "wf_portfolio",
      "n8n",
      "http://localhost:5678/webhook/test",
      "usr_1",
      "trace_1",
      "chat",
      { query: "hello" },
      "thread_1",
    );

    expect(run.status).toBe("queued");
    expect(run.workflowKey).toBe("wf_portfolio");
    expect(dispatchCalled).toBe(1);
  });
});

