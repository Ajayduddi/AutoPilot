import { afterEach, describe, expect, it } from "bun:test";
import {
  buildForcedAgentQuestion,
  parseAgentQuestionBlock,
  shouldForceAgentQuestion,
} from "../../../src/services/agent/agent-question.service";
import { resetRuntimeConfigCache } from "../../../src/config/runtime.config";

const ORIGINAL_ENV = process.env.FEATURE_INTERACTIVE_QUESTIONS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.FEATURE_INTERACTIVE_QUESTIONS;
  } else {
    process.env.FEATURE_INTERACTIVE_QUESTIONS = ORIGINAL_ENV;
  }
  resetRuntimeConfigCache();
});

describe("agent question helper behavior", () => {
  it("parses numbered actionable question blocks into question_mcq blocks", () => {
    const block = parseAgentQuestionBlock([
      "Would you like me to continue?",
      "1. Yes, proceed - Run the workflow now",
      "2. Not now - Keep the current context",
    ].join("\n"));

    expect(block).toBeTruthy();
    expect(block?.type).toBe("question_mcq");
    expect(block?.prompt).toContain("Would you like");
    expect(Array.isArray(block?.options)).toBe(true);
    expect(block?.options).toHaveLength(2);
    expect(block?.options[0]?.valueToSend).toBe("yes proceed");
    expect(block?.options[1]?.valueToSend).toBe("no");
  });

  it("returns null for non-actionable numbered lists", () => {
    const block = parseAgentQuestionBlock([
      "Here are some formatting choices:",
      "1. Shorter",
      "2. More formal",
    ].join("\n"));

    expect(block).toBeNull();
  });

  it("detects execution-style forced interactive questions and ignores non-execution help prompts", () => {
    process.env.FEATURE_INTERACTIVE_QUESTIONS = "true";
    resetRuntimeConfigCache();
    expect(shouldForceAgentQuestion("Would you like me to run the daily report workflow now?")).toBe(true);
    expect(shouldForceAgentQuestion("Would you like me to rewrite this in a shorter tone?")).toBe(false);
  });

  it("builds a forced agent question with workflow hint when present", () => {
    const block = buildForcedAgentQuestion("I can run the daily report workflow now if you want.");

    expect(block.type).toBe("question_mcq");
    expect(block.prompt).toContain("daily report");
    expect(block.options).toHaveLength(2);
    expect(block.options[0]?.recommended).toBe(true);
  });
});
