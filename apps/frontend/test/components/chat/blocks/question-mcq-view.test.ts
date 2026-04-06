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
