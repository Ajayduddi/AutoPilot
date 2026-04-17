/**
 * @fileoverview apps/frontend/test/components/chat/markdown-content.test.ts
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
import { normalizeLooseListMarkdown } from "../../../src/components/chat/markdown-normalize";

describe("MarkdownContent normalization", () => {
  it("turns emoji section headings and inline helper bullets into stable markdown blocks", () => {
    const input = [
      "Here's what I can do for you right now:",
      "",
      "🔧 Immediate Actions",
      "• Profile & Portfolio - Fetch your personal details, projects, and experience.",
      "• Leetcode Stats - Check solved problems.",
      "",
      "📌 Other Helpers",
      "📝 Resume/CV Review - Analyze and suggest improvements. 💡 Project Ideas - Suggest next steps. 🔍 Job Search - Help refine your search.",
    ].join("\n");

    const normalized = normalizeLooseListMarkdown(input);

    expect(normalized).toContain("### 🔧 Immediate Actions");
    expect(normalized).toContain("### 📌 Other Helpers");
    expect(normalized).toContain("- Resume/CV Review - Analyze and suggest improvements.");
    expect(normalized).toContain("- Project Ideas - Suggest next steps.");
    expect(normalized).toContain("- Job Search - Help refine your search.");
  });

  it("adds spacing before common prose headings so they do not collapse into prior paragraphs", () => {
    const input = [
      "Profile Rating: 9.2/10",
      "Key Strengths (9.2/10)",
      "✅ Technical Depth (9.5/10) - Strong React and backend experience.",
      "Areas for Improvement (8/10)",
      "🔹 Open-Source Contributions - Limited public activity.",
    ].join("\n");

    const normalized = normalizeLooseListMarkdown(input);

    expect(normalized).toContain("Profile Rating: 9.2/10\n\nKey Strengths (9.2/10)");
    expect(normalized).toContain("Areas for Improvement (8/10)\n\n- Open-Source Contributions - Limited public activity.");
  });
});
