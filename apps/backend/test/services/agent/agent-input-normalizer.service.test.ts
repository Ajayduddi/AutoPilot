import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ChatService } from "../../../src/services/chat.service";
import { normalizeInputForAgent } from "../../../src/services/agent/agent-input-normalizer.service";

const originals = {
  getMessages: ChatService.getMessages,
};

beforeEach(() => {
  (ChatService as any).getMessages = originals.getMessages;
});

afterEach(() => {
  (ChatService as any).getMessages = originals.getMessages;
});

describe("agent input normalizer", () => {
  it("normalizes slash workflow commands into explicit execution instructions", async () => {
    const normalized = await normalizeInputForAgent("thread_1", "/daily_report region=us");

    expect(normalized.slashWorkflowKey).toBe("daily_report");
    expect(normalized.normalizedContent).toContain('Workflow key: "daily_report"');
    expect(normalized.normalizedContent).toContain("Additional user payload: region=us");
  });

  it("turns confirmation replies into workflow execution guidance when a pending workflow is detectable", async () => {
    (ChatService as any).getMessages = async () => ([
      {
        role: "user",
        content: "Please get the latest daily revenue data",
      },
      {
        role: "assistant",
        content: "I can fetch that by running the daily revenue workflow.",
        blocks: [
          {
            type: "question_mcq",
            prompt: "Should I run the daily revenue workflow now?",
            options: [
              { label: "Yes, proceed", description: "Run it now" },
              { label: "Not now", description: "Skip it" },
            ],
          },
        ],
      },
    ]);

    const normalized = await normalizeInputForAgent("thread_1", "yes proceed");

    expect(normalized.pendingWorkflowKey).toBe("daily revenue");
    expect(normalized.priorUserGoal).toBe("Please get the latest daily revenue data");
    expect(normalized.normalizedContent).toContain('Immediately run the workflow "daily revenue"');
    expect(normalized.normalizedContent).toContain("answer the user's request directly from the workflow result");
  });

  it("preserves normal content while still surfacing detected pending workflow context", async () => {
    (ChatService as any).getMessages = async () => ([
      {
        role: "assistant",
        content: "You can fetch that by running the inventory sync workflow.",
      },
    ]);

    const normalized = await normalizeInputForAgent("thread_1", "What happened yesterday?");

    expect(normalized.normalizedContent).toBe("What happened yesterday?");
    expect(normalized.pendingWorkflowKey).toBe("inventory sync");
  });
});
