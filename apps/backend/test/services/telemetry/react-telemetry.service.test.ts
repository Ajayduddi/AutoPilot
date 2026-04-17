import { describe, expect, it } from "bun:test";
import {
  buildReActTelemetryMetadata,
} from "../../../src/services/telemetry/react-telemetry.service";

describe("react telemetry service", () => {
  it("builds compact telemetry metadata with repeated tool-call counts", () => {
    const metadata = buildReActTelemetryMetadata({
      source: "orchestrator",
      answerMode: "followup_answer",
      threadId: "thread_1",
      workflowKey: "inventory_sync",
      toolCalls: ["search_workflows", "search_workflows", "run_workflow"],
      stepCount: 4,
      contextsUsed: 2,
      workflowsUsed: ["inventory_sync"],
      relevantRuns: 3,
      requestedFields: ["status", "updated_at"],
      usedFieldExtraction: true,
      cacheHit: false,
      rerunAvoided: true,
      confidence: "high",
    });

    expect(metadata).toContain("reactSource: orchestrator");
    expect(metadata).toContain("reactAnswerMode: followup_answer");
    expect(metadata).toContain("reactWorkflow: inventory_sync");
    expect(metadata).toContain("reactContextsUsed: 2");
    expect(metadata).toContain("reactToolCalls: 3");
    expect(metadata).toContain("reactRepeatedToolCalls: 1");
    expect(metadata).toContain("reactFieldExtraction: true");
    expect(metadata).toContain("reactRerunAvoided: true");
    expect(metadata).toContain("reactConfidence: high");
  });
});
