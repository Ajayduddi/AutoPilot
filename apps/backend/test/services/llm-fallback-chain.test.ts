import { describe, expect, it } from "bun:test";
import { LLMService } from "../../src/services/llm.service";
import { AutoModelRouterService } from "../../src/services/auto-router.service";
import { WorkflowService } from "../../src/services/workflow.service";
import type { AutoRouterCandidate } from "../../src/services/auto-router.service";
import type { ILLMProvider } from "../../src/providers/llm/provider.interface";

function fakeCandidate(
  key: string,
  provider: ILLMProvider,
): AutoRouterCandidate {
  return {
    candidateKey: key,
    providerConfigId: key,
    provider: "test",
    providerLabel: "Test",
    model: key,
    mastraModel: key,
    score: 1,
    scoreBreakdown: { quality: 1, reliability: 0, latency: 0, defaultBonus: 0 },
    providerInstance: provider,
  };
}

describe("LLM fallback chain", () => {
  it("parseIntent falls through failed candidates and succeeds on next", async () => {
    const originalResolve = AutoModelRouterService.resolveCandidates;
    const originalGetAll = WorkflowService.getAll;
    const originalSuccess = AutoModelRouterService.reportSuccess;
    const originalFailure = AutoModelRouterService.reportFailure;
    let successCount = 0;
    let failureCount = 0;

    const badProvider: ILLMProvider = {
      name: "bad",
      async parseIntent() { throw new Error("bad provider down"); },
      async generateReply() { return "unused"; },
    };
    const goodProvider: ILLMProvider = {
      name: "good",
      async parseIntent() { return { type: "chat", reply: "ok" }; },
      async generateReply() { return "unused"; },
    };

    (WorkflowService as any).getAll = async () => [];
    (AutoModelRouterService as any).resolveCandidates = async () => ({
      mode: "auto",
      candidates: [fakeCandidate("bad", badProvider), fakeCandidate("good", goodProvider)],
    });
    (AutoModelRouterService as any).reportSuccess = () => { successCount += 1; };
    (AutoModelRouterService as any).reportFailure = () => { failureCount += 1; };

    const parsed = await LLMService.parseIntent("hello");
    expect(parsed.type).toBe("chat");
    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    (AutoModelRouterService as any).resolveCandidates = originalResolve;
    (WorkflowService as any).getAll = originalGetAll;
    (AutoModelRouterService as any).reportSuccess = originalSuccess;
    (AutoModelRouterService as any).reportFailure = originalFailure;
  });

  it("streamReply does not failover once chunks were already emitted", async () => {
    const originalResolve = AutoModelRouterService.resolveCandidates;
    const originalGetAll = WorkflowService.getAll;

    const partialProvider: ILLMProvider = {
      name: "partial",
      async parseIntent() { return { type: "chat", reply: "ok" }; },
      async generateReply() { return "unused"; },
      async *generateReplyStream() {
        yield "partial ";
        throw new Error("mid-stream failure");
      },
    };
    const backupProvider: ILLMProvider = {
      name: "backup",
      async parseIntent() { return { type: "chat", reply: "ok" }; },
      async generateReply() { return "backup"; },
      async *generateReplyStream() {
        yield "backup";
      },
    };

    (WorkflowService as any).getAll = async () => [];
    (AutoModelRouterService as any).resolveCandidates = async () => ({
      mode: "auto",
      candidates: [fakeCandidate("partial", partialProvider), fakeCandidate("backup", backupProvider)],
    });

    const chunks: string[] = [];
    let thrown: Error | null = null;
    try {
      for await (const chunk of LLMService.streamReply("hello")) {
        chunks.push(chunk);
      }
    } catch (err: any) {
      thrown = err;
    }

    expect(chunks.join("")).toContain("partial");
    expect(thrown).toBeTruthy();
    expect(String(thrown?.message || "")).toContain("mid-stream failure");

    (AutoModelRouterService as any).resolveCandidates = originalResolve;
    (WorkflowService as any).getAll = originalGetAll;
  });

  it("streamReply succeeds after N upstream failures and remains deterministic under concurrency", async () => {
    const originalResolve = AutoModelRouterService.resolveCandidates;
    const originalGetAll = WorkflowService.getAll;

    const badProviderA: ILLMProvider = {
      name: "bad-a",
      async parseIntent() { return { type: "chat", reply: "ok" }; },
      async generateReply() { throw new Error("a down"); },
    };
    const badProviderB: ILLMProvider = {
      name: "bad-b",
      async parseIntent() { return { type: "chat", reply: "ok" }; },
      async generateReply() { throw new Error("b timeout"); },
    };
    const goodProvider: ILLMProvider = {
      name: "good",
      async parseIntent() { return { type: "chat", reply: "ok" }; },
      async generateReply() { return "final-answer"; },
    };

    (WorkflowService as any).getAll = async () => [];
    (AutoModelRouterService as any).resolveCandidates = async () => ({
      mode: "auto",
      candidates: [
        fakeCandidate("bad-a", badProviderA),
        fakeCandidate("bad-b", badProviderB),
        fakeCandidate("good", goodProvider),
      ],
    });

    const runOne = async () => {
      const out: string[] = [];
      for await (const chunk of LLMService.streamReply("hello")) out.push(chunk);
      return out.join("");
    };

    const results = await Promise.all(Array.from({ length: 12 }, () => runOne()));
    expect(results.every((item) => item === "final-answer")).toBe(true);

    (AutoModelRouterService as any).resolveCandidates = originalResolve;
    (WorkflowService as any).getAll = originalGetAll;
  });

  it("parseIntent returns deterministic chat fallback when all candidates fail", async () => {
    const originalResolve = AutoModelRouterService.resolveCandidates;
    const originalGetAll = WorkflowService.getAll;

    const failingProvider: ILLMProvider = {
      name: "failing",
      async parseIntent() { throw new Error("provider outage"); },
      async generateReply() { return "unused"; },
    };

    (WorkflowService as any).getAll = async () => [];
    (AutoModelRouterService as any).resolveCandidates = async () => ({
      mode: "auto",
      candidates: [fakeCandidate("failing", failingProvider)],
    });

    const parsed = await LLMService.parseIntent("hello");
    expect(parsed.type).toBe("chat");
    expect(String(parsed.reply || "")).toContain("lost connection");

    (AutoModelRouterService as any).resolveCandidates = originalResolve;
    (WorkflowService as any).getAll = originalGetAll;
  });
});
