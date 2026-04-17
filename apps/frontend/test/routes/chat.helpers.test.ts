/**
 * @fileoverview apps/frontend/test/routes/chat.helpers.test.ts
 *
 * High-level purpose:
 * Frontend test module for unit/integration verification of UI behavior, helpers, and route-level logic.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Validates deterministic behavior of components and utilities.
 * - Captures edge cases and contract expectations in test fixtures.
 * - Improves safety for refactors through focused assertions.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import module under test and assemble required test doubles.
 * 2. Write assertions for nominal, boundary, and failure paths.
 * 3. Run targeted tests to verify intended behavior.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
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
