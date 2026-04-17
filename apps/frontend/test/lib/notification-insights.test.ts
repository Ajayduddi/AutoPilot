/**
 * @fileoverview apps/frontend/test/lib/notification-insights.test.ts
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
  buildFollowUpDraft,
  getNotificationDisplayTitle,
  getWorkflowInsight,
} from "../../src/lib/notification-insights";
import type { InboxNotification } from "../../src/context/notifications.context";

function notification(overrides: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id: "n1",
    type: "workflow_event",
    title: "Workflow completed",
    message: "Fallback message",
    read: false,
    createdAt: new Date().toISOString(),
    runId: "run_1",
    ...overrides,
  };
}

describe("notification-insights", () => {
  it("extracts workflow insight and applies array limits", () => {
    const insight = getWorkflowInsight(
      notification({
        data: {
          summary: "  Workflow finished successfully.  ",
          bullets: [" one ", "two", "three", "four", "five"],
          rawPreview: "raw",
          suggestedQuestions: ["q1", "q2", "q3", "q4"],
          workflowKey: "wf_portfolio",
          provider: "n8n",
          status: "completed",
          traceId: "trace_1",
          generatedBy: "ai",
        },
      }),
    );

    expect(insight).not.toBeNull();
    expect(insight?.summary).toBe("Workflow finished successfully.");
    expect(insight?.bullets).toEqual(["one", "two", "three", "four"]);
    expect(insight?.suggestedQuestions).toEqual(["q1", "q2", "q3"]);
    expect(insight?.runId).toBe("run_1");
    expect(insight?.generatedBy).toBe("ai");
  });

  it("returns null when notification data has no useful insight", () => {
    expect(getWorkflowInsight(notification({ data: "not-an-object" }))).toBeNull();
    expect(getWorkflowInsight(notification({ data: { kind: "note" } }))).toBeNull();
  });

  it("prefers humanized insight summary for generic workflow titles", () => {
    const title = getNotificationDisplayTitle(
      notification({
        title: "Workflow completed",
        data: { summary: "Portfolio sync completed. All records are aligned now." },
      }),
    );
    expect(title).toBe("Portfolio sync completed");
  });

  it("falls back to message headline for generic titles without insight summary", () => {
    const title = getNotificationDisplayTitle(
      notification({
        title: "Workflow failed",
        data: { bullets: ["A"] },
        message: "Provider timeout occurred. Retry after a minute.",
      }),
    );
    expect(title).toBe("Provider timeout occurred");
  });

  it("keeps explicit non-generic notification titles unchanged", () => {
    const title = getNotificationDisplayTitle(notification({ title: "Security alert: key rotated" }));
    expect(title).toBe("Security alert: key rotated");
  });

  it("builds capped follow-up draft with trimmed question", () => {
    const insight = getWorkflowInsight(
      notification({
        data: {
          summary: "S".repeat(700),
          bullets: ["B".repeat(260), "done"],
          traceId: "trace_999",
          runId: "run_999",
          workflowKey: "wf_email",
        },
      }),
    );
    const draft = buildFollowUpDraft(notification({ title: "Workflow completed" }), insight, "   What failed?  ");
    expect(draft).toContain("My question: What failed?");
    expect(draft).toContain("Run ID: run_999");
    expect(draft).toContain("Trace ID: trace_999");
    expect(draft.length).toBeLessThanOrEqual(1303);
  });
});
