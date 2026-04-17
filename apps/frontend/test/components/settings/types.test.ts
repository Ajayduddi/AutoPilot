/**
 * @fileoverview apps/frontend/test/components/settings/types.test.ts
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
  EMAIL_REGEX,
  formatDate,
  providerLabel,
  providerSelectOptions,
} from "../../../src/components/settings/types";

describe("settings/types utilities", () => {
  it("maps provider labels with legacy ollama_cloud support", () => {
    expect(providerLabel("openai")).toBe("OpenAI Compatible API");
    expect(providerLabel("ollama")).toBe("Ollama");
    expect(providerLabel("ollama_cloud")).toBe("Ollama");
    expect(providerLabel("unknown-provider")).toBe("unknown-provider");
  });

  it("keeps expected provider options available", () => {
    const values = providerSelectOptions.map((item) => item.value);
    expect(values).toEqual(["openai", "ollama", "mistral", "gemini", "groq"]);
  });

  it("formats date fallback states safely", () => {
    expect(formatDate()).toBe("Never");
    expect(formatDate(null)).toBe("Never");
    expect(formatDate("not-a-date")).toBe("Unknown");
    expect(formatDate("2026-01-01T10:00:00.000Z")).not.toBe("Never");
    expect(formatDate("2026-01-01T10:00:00.000Z")).not.toBe("Unknown");
  });

  it("validates email regex for common valid/invalid values", () => {
    expect(EMAIL_REGEX.test("ajay@example.com")).toBeTrue();
    expect(EMAIL_REGEX.test("test.user+tag@sub.domain.org")).toBeTrue();
    expect(EMAIL_REGEX.test("missing-at-symbol.com")).toBeFalse();
    expect(EMAIL_REGEX.test("missing-domain@")).toBeFalse();
    expect(EMAIL_REGEX.test("space in@email.com")).toBeFalse();
  });
});
