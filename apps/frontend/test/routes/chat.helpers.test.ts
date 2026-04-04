import { describe, expect, it } from "bun:test";
import {
  coerceWorkflowStatus,
  fallbackAssistantBlocks,
  humanizeStatus,
  humanizeWorkflowKey,
  normalizeProviderName,
  prettyProviderName,
} from "../../src/routes/chat.helpers";

describe("chat.helpers", () => {
  it("normalizes provider names", () => {
    expect(normalizeProviderName("ollama_cloud")).toBe("ollama");
    expect(normalizeProviderName("ollama")).toBe("ollama");
    expect(normalizeProviderName("GEMINI")).toBe("gemini");
    expect(normalizeProviderName("")).toBe("provider");
  });

  it("builds pretty provider names", () => {
    expect(prettyProviderName("openai")).toBe("OpenAI");
    expect(prettyProviderName("groq")).toBe("Groq");
  });

  it("humanizes workflow labels/status", () => {
    expect(humanizeWorkflowKey("wf_portfolio-sync")).toBe("Wf Portfolio Sync");
    expect(humanizeStatus("waiting_approval")).toBe("waiting for approval");
    expect(humanizeStatus("in_progress")).toBe("in progress");
  });

  it("coerces unknown statuses to running", () => {
    expect(coerceWorkflowStatus("completed")).toBe("completed");
    expect(coerceWorkflowStatus("failed")).toBe("failed");
    expect(coerceWorkflowStatus("random")).toBe("running");
    expect(coerceWorkflowStatus(undefined)).toBe("running");
  });

  it("creates fallback assistant blocks", () => {
    const blocks = fallbackAssistantBlocks("Hello world. Second sentence.");
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.type).toBe("summary");
    expect(blocks[1]?.type).toBe("markdown");
  });
});
