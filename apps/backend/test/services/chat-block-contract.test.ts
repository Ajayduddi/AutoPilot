import { describe, expect, it } from "bun:test";
import { isChatBlocksEnvelope } from "@autopilot/shared";

describe("chat block contract baseline", () => {
  it("accepts direct chat response block sequence", () => {
    const envelope = {
      blocks: [
        { type: "summary", items: ["Main agent handled this as a direct chat response (no subagent execution)."] },
        {
          type: "detail_toggle",
          summary: "Intent: chat • Next: answer directly • Confidence: high",
          meta: { planKind: "main_agent" },
          children: [{ type: "markdown", text: "1. Plan step" }],
        },
        { type: "markdown", text: "Answer text" },
        { type: "source", origin: "Follow-up Context — thread", metadata: ["answerMode: context_followup"] },
      ],
    };
    expect(isChatBlocksEnvelope(envelope)).toBe(true);
  });

  it("accepts workflow execution response block sequence", () => {
    const envelope = {
      blocks: [
        { type: "summary", items: ["Main agent selected subagent **portfolio** from workflow registry."] },
        {
          type: "detail_toggle",
          summary: "Intent: workflow • Selected: portfolio • Next: execute workflow • Confidence: high",
          meta: { planKind: "main_agent" },
          children: [{ type: "markdown", text: "1. Execute workflow" }],
        },
        { type: "workflow_status", workflow: { name: "portfolio", status: "completed", runId: "run_1" } },
        { type: "markdown", text: "Grounded answer from workflow data." },
        { type: "source", origin: "N8n Workflow Engine", metadata: ["answerMode: workflow_execution_answer"] },
      ],
    };
    expect(isChatBlocksEnvelope(envelope)).toBe(true);
  });

  it("accepts email draft response block sequence with multiple drafts", () => {
    const envelope = {
      blocks: [
        { type: "summary", items: ["Main agent handled this as a direct chat response (no subagent execution)."] },
        {
          type: "detail_toggle",
          summary: "Intent: chat • Next: answer directly • Confidence: high",
          meta: { planKind: "main_agent" },
          children: [{ type: "markdown", text: "1. Draft email" }],
        },
        { type: "email_draft", subject: "Subject A", body: "Dear Name,\n\nBody A\n\nRegards,\nName" },
        { type: "email_draft", subject: "Subject B", body: "Dear Name,\n\nBody B\n\nRegards,\nName", label: "Warm & Heartfelt" },
      ],
    };
    expect(isChatBlocksEnvelope(envelope)).toBe(true);
  });

  it("accepts interactive approval/question continuation block sequence", () => {
    const envelope = {
      blocks: [
        { type: "summary", items: ["Main agent handled this as direct chat response (no subagent execution)."] },
        {
          type: "question_mcq",
          questionId: "q_1",
          prompt: "Choose how you want to continue:",
          options: [
            { id: "a", label: "Approve and run", valueToSend: "yes proceed" },
            { id: "b", label: "Cancel", valueToSend: "cancel" },
          ],
        },
        { type: "source", origin: "Interactive Question", metadata: ["answerMode: interactive_question"] },
      ],
    };
    expect(isChatBlocksEnvelope(envelope)).toBe(true);
  });

  it("accepts approval-gated workflow block sequence", () => {
    const envelope = {
      blocks: [
        { type: "summary", items: ["Main agent planned portfolio, approval required before execution."] },
        {
          type: "detail_toggle",
          summary: "Intent: workflow • Selected: portfolio • Next: request approval • Confidence: high",
          meta: { planKind: "main_agent" },
          children: [{ type: "markdown", text: "1. Request user approval for sensitive action." }],
        },
        {
          type: "approval_card",
          approvalId: "apr_1",
          summary: "Approve workflow execution",
          details: { workflow: "wf_portfolio", risk: "medium" },
          status: "pending",
          approveActionId: "approve:apr_1",
          rejectActionId: "reject:apr_1",
        },
        { type: "source", origin: "ReAct Telemetry", metadata: ["answerMode: approval_pending"] },
      ],
    };
    expect(isChatBlocksEnvelope(envelope)).toBe(true);
  });

  it("accepts workflow failure block sequence with error result", () => {
    const envelope = {
      blocks: [
        { type: "summary", items: ["Main agent triggered workflow with failure status."] },
        {
          type: "workflow_status",
          workflow: { name: "portfolio", status: "failed", runId: "run_failed_1" },
        },
        {
          type: "error",
          title: "Execution Failed",
          items: ["✗ Execution failed", "Error: upstream provider unavailable"],
          message: "Execution failed",
        },
        {
          type: "source",
          origin: "N8n Workflow Engine",
          metadata: ["answerMode: workflow_execution", "Workflow: wf_portfolio", "Run: run_failed_1"],
        },
      ],
    };
    expect(isChatBlocksEnvelope(envelope)).toBe(true);
  });

  it("rejects malformed envelope when required block type is missing", () => {
    const badEnvelope = {
      blocks: [
        { items: ["missing type"] },
      ],
    } as any;
    expect(isChatBlocksEnvelope(badEnvelope)).toBe(false);
  });
});
