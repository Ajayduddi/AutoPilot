/**
 * @fileoverview apps/frontend/test/components/chat/blocks/question-mcq-view.test.ts
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
import { isWorkflowProceedPrompt } from "../../../../src/components/chat/blocks/question-mcq-utils";
import type { QuestionMcqBlock } from "../../../../src/components/chat/types";

function block(overrides: Partial<QuestionMcqBlock> = {}): QuestionMcqBlock {
  return {
    type: "question_mcq",
    questionId: "q1",
    prompt: "Choose one option",
    options: [
      { id: "1", label: "Yes", valueToSend: "yes" },
      { id: "2", label: "No", valueToSend: "no" },
    ],
    ...overrides,
  };
}

describe("QuestionMcqView/isWorkflowProceedPrompt", () => {
  it("detects proceed-style workflow prompts", () => {
    const result = isWorkflowProceedPrompt(
      block({
        prompt: "I can proceed with the requested workflow action. Choose how you want to continue:",
        options: [
          { id: "run", label: "Approve and run", valueToSend: "run_now" },
          { id: "later", label: "Not now", valueToSend: "not_now" },
        ],
      }),
    );
    expect(result).toBeTrue();
  });

  it("does not classify normal informational questions as proceed prompts", () => {
    const result = isWorkflowProceedPrompt(
      block({
        prompt: "Would you like this formatted as a table or bullets?",
        options: [
          { id: "table", label: "Table format", valueToSend: "table" },
          { id: "bullets", label: "Bullet list", valueToSend: "bullets" },
        ],
      }),
    );
    expect(result).toBeFalse();
  });
});
