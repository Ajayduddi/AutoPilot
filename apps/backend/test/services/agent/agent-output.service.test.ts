import { describe, expect, it } from "bun:test";
import {
  buildAgentPlanLines,
  buildAgentSourceMetadata,
  formatAttemptChain,
  type AgentCandidateAttempt,
} from "../../../src/services/agent/agent-output.service";

const baseCandidate = {
  id: "prov_1",
  provider: "openai",
  providerLabel: "openai",
  model: "gpt-4o-mini",
  mastraModel: "openai:gpt-4o-mini",
  isDefault: true,
  score: 10,
  providerInstance: {} as any,
  candidateKey: "prov_1::gpt-4o-mini",
};

const baseDecision = {
  mode: "auto" as const,
  candidates: [],
  routingHint: "reasoning_heavy" as const,
  preferredModelPoolUsed: true,
};

describe("agent output helper behavior", () => {
  it("formats attempt chains with failed markers", () => {
    const attempts: AgentCandidateAttempt[] = [
      { candidate: baseCandidate as any, ok: false },
      { candidate: { ...baseCandidate, model: "gpt-4.1-mini" } as any, ok: true },
    ];

    expect(formatAttemptChain(attempts)).toBe("openai:gpt-4o-mini× -> openai:gpt-4.1-mini");
  });

  it("builds plan lines with workflow and MCP context", () => {
    const lines = buildAgentPlanLines({
      executedModel: "openai:gpt-4o-mini",
      selected: baseCandidate as any,
      decision: baseDecision as any,
      attempts: [{ candidate: baseCandidate as any, ok: true }],
      toolCalls: [{ toolName: "search_workflows" }, { toolName: "trigger_workflow_async" }],
      normalized: {
        normalizedContent: "run it",
        slashWorkflowKey: "daily_report",
        pendingWorkflowKey: "daily_report",
        priorUserGoal: "Send me the latest report",
      },
      mcpErrors: ["connector unavailable"],
    });

    expect(lines).toContain("Model: `openai:gpt-4o-mini`");
    expect(lines).toContain("Slash workflow: `daily_report`");
    expect(lines).toContain("Pending workflow: `daily_report`");
    expect(lines).toContain("Prior user goal: Send me the latest report");
    expect(lines).toContain("1. search_workflows");
    expect(lines).toContain("2. trigger_workflow_async");
    expect(lines).toContain("MCP warnings: connector unavailable");
  });

  it("builds source metadata with failover details and routing hints", () => {
    const attempts: AgentCandidateAttempt[] = [
      { candidate: baseCandidate as any, ok: false, error: "timeout" },
      { candidate: { ...baseCandidate, model: "gpt-4.1-mini" } as any, ok: true, latencyMs: 1200 },
    ];

    const metadata = buildAgentSourceMetadata({
      selected: { ...baseCandidate, model: "gpt-4.1-mini" } as any,
      decision: baseDecision as any,
      attempts,
      toolCalls: 2,
      slashWorkflowKey: "daily_report",
      mcpToolCount: 4,
      mcpErrors: ["connector unavailable"],
      historyCount: 6,
      executedModel: "openai:gpt-4.1-mini",
    });

    expect(metadata).toContain("runtime: mastra_runtime");
    expect(metadata).toContain("answerMode: auto_routed");
    expect(metadata).toContain("modelTier: preferred_reasoning");
    expect(metadata).toContain("preferredModelPoolUsed: true");
    expect(metadata).toContain("failoverCount: 1");
    expect(metadata).toContain("attempted: openai:gpt-4o-mini× -> openai:gpt-4.1-mini");
    expect(metadata).toContain("slashWorkflow: daily_report");
    expect(metadata).toContain("mcpToolsLoaded: 4");
  });
});
