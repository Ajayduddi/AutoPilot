/**
 * @fileoverview apps/frontend/test/components/chat/block-layout-utils.test.ts
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
import { shouldUseScrollableContentBlock } from "../../../src/components/chat/block-layout-utils";

describe("block layout utils", () => {
  it("does not constrain short normal answers", () => {
    expect(shouldUseScrollableContentBlock("Short answer with two lines.\nNothing special here.")).toBeFalse();
  });

  it("constrains long markdown-heavy answers", () => {
    const value = [
      "# Resume",
      "## Summary",
      "Experienced engineer with a broad project portfolio.",
      "## Experience",
      ...Array.from({ length: 18 }, (_, index) => `- Bullet ${index + 1}: detailed work item and result`),
      "## Skills",
      "React, SolidJS, TypeScript, Express, Postgres",
    ].join("\n");

    expect(shouldUseScrollableContentBlock(value)).toBeTrue();
  });

  it("constrains fenced-code style payloads", () => {
    const value = [
      "```markdown",
      ...Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`),
      "```",
    ].join("\n");

    expect(shouldUseScrollableContentBlock(value)).toBeTrue();
  });
});
