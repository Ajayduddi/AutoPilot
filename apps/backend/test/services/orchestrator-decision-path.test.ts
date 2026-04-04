import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OrchestratorService } from "../../src/services/orchestrator.service";
import { ChatService } from "../../src/services/chat.service";
import { ChatRepo } from "../../src/repositories/chat.repo";
import { ContextService } from "../../src/services/context.service";
import { MainAgentService } from "../../src/services/main-agent.service";
import { WorkflowService } from "../../src/services/workflow.service";

type SavedMessageInput = {
  threadId: string;
  role: string;
  content: string;
  options?: any;
};

const originals = {
  addMessage: ChatService.addMessage,
  getMessages: ChatService.getMessages,
  listAttachmentsByThread: ChatRepo.listAttachmentsByThread,
  getThreadContext: ContextService.getThreadContext,
  formatForPrompt: ContextService.formatForPrompt,
  getLastWorkflowContext: ContextService.getLastWorkflowContext,
  searchContext: ContextService.searchContext,
  decide: MainAgentService.decide,
  getByKeyInternal: WorkflowService.getByKeyInternal,
};

let savedMessages: SavedMessageInput[] = [];

function makeChatDecision(finalReply: string) {
  return {
    mode: "chat" as const,
    planId: "plan_test",
    planStepId: "step_test",
    reasoning: "deterministic test decision",
    reactState: {
      goal: finalReply,
      intentType: "chat" as const,
      candidateCount: 0,
      shortlistedCandidates: [],
      evidenceSources: [],
      missingEvidence: [],
      confidence: "high" as const,
      nextAction: "answer_directly",
      observations: [{ phase: "understand" as const, summary: "Intent classified as chat." }],
    },
    finalReply,
  };
}

beforeEach(() => {
  savedMessages = [];

  (ChatService as any).addMessage = async (
    threadId: string,
    role: string,
    content: string,
    options?: any,
  ) => {
    savedMessages.push({ threadId, role, content, options });
    return { id: `msg_${savedMessages.length}`, createdAt: new Date().toISOString() };
  };
  (ChatService as any).getMessages = async () => [];
  (ChatRepo as any).listAttachmentsByThread = async () => [];
  (ContextService as any).getThreadContext = async () => [];
  (ContextService as any).formatForPrompt = () => "";
  (ContextService as any).getLastWorkflowContext = async () => null;
  (ContextService as any).searchContext = async () => [];
  (MainAgentService as any).decide = async () => makeChatDecision("Default reply");
  (WorkflowService as any).getByKeyInternal = async () => null;
});

afterEach(() => {
  (ChatService as any).addMessage = originals.addMessage;
  (ChatService as any).getMessages = originals.getMessages;
  (ChatRepo as any).listAttachmentsByThread = originals.listAttachmentsByThread;
  (ContextService as any).getThreadContext = originals.getThreadContext;
  (ContextService as any).formatForPrompt = originals.formatForPrompt;
  (ContextService as any).getLastWorkflowContext = originals.getLastWorkflowContext;
  (ContextService as any).searchContext = originals.searchContext;
  (MainAgentService as any).decide = originals.decide;
  (WorkflowService as any).getByKeyInternal = originals.getByKeyInternal;
});

describe("OrchestratorService decision-path unit coverage", () => {
  it("handles temporal questions deterministically without workflow/agent execution", async () => {
    await OrchestratorService.handleIncomingMessage(
      "thread_temporal",
      "what is time now?",
      "trace_temporal",
      "user_1",
      undefined,
      undefined,
      [],
      { profileTimezone: "UTC" },
    );

    expect(savedMessages.length).toBe(1);
    const blocks = savedMessages[0].options?.blocks || [];
    expect(blocks[0]?.type).toBe("summary");
    expect(String(blocks[0]?.items?.[0] || "")).toContain("deterministic temporal response");
    expect(blocks[1]?.type).toBe("markdown");
    expect(String(blocks[1]?.text || "")).toContain("Current time in UTC");
    expect(blocks[2]?.type).toBe("source");
    expect(blocks[2]?.origin).toBe("Deterministic Clock");
  });

  it("returns direct chat block flow when main agent picks chat mode", async () => {
    (MainAgentService as any).decide = async () =>
      makeChatDecision("Here is your concise answer from chat mode.");

    await OrchestratorService.handleIncomingMessage(
      "thread_chat",
      "give me a quick summary",
      "trace_chat",
      "user_1",
      undefined,
      undefined,
      [],
    );

    expect(savedMessages.length).toBe(1);
    const blocks = savedMessages[0].options?.blocks || [];
    expect(blocks[0]?.type).toBe("summary");
    expect(String(blocks[0]?.items?.[0] || "")).toContain("direct chat response");
    expect(blocks[1]?.type).toBe("detail_toggle");
    expect(String(blocks[1]?.summary || "")).toContain("Intent: chat");
    expect(blocks[2]?.type).toBe("markdown");
    expect(blocks[2]?.text).toBe("Here is your concise answer from chat mode.");
  });

  it("returns workflow validation error block when selected workflow is disabled", async () => {
    (MainAgentService as any).decide = async () => ({
      mode: "workflow",
      planId: "plan_wf",
      planStepId: "step_wf",
      reasoning: "workflow selected",
      reactState: {
        goal: "run workflow",
        intentType: "workflow",
        requestedWorkflowKey: "wf_portfolio",
        candidateCount: 1,
        shortlistedCandidates: [
          { workflowKey: "wf_portfolio", workflowName: "portfolio", score: 100, reasons: ["exact intent match"] },
        ],
        selectedWorkflowKey: "wf_portfolio",
        selectedWorkflowName: "portfolio",
        evidenceSources: ["thread_context"],
        missingEvidence: [],
        confidence: "high",
        nextAction: "execute_workflow",
        observations: [{ phase: "understand", summary: "Workflow requested explicitly." }],
      },
      selectedSubagent: {
        workflowId: "wf_1",
        workflowKey: "wf_portfolio",
        workflowName: "portfolio",
        provider: "n8n",
      },
      riskEvaluation: { level: "low", reason: "Safe read-only workflow" },
      requiresApproval: false,
    });
    (WorkflowService as any).getByKeyInternal = async () => ({
      id: "wf_1",
      key: "wf_portfolio",
      name: "portfolio",
      archived: false,
      enabled: false,
      executionEndpoint: "http://example.com/webhook",
      visibility: "public",
      provider: "n8n",
    });

    await OrchestratorService.handleIncomingMessage(
      "thread_wf",
      "run my portfolio workflow",
      "trace_wf",
      "user_1",
      undefined,
      undefined,
      [],
    );

    expect(savedMessages.length).toBe(1);
    expect(savedMessages[0].content).toContain("currently disabled");
    const blocks = savedMessages[0].options?.blocks || [];
    expect(blocks[0]?.type).toBe("error");
    expect(blocks[0]?.code).toBe("WORKFLOW_DISABLED");
  });
});

