/**
 * @fileoverview apps/frontend/test/lib/workflow-form-options.test.tsx
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
  authTypeOptions,
  httpMethodOptions,
  providerFilterOptions,
  providerLabels,
  providerOptions,
  triggerMethodOptions,
  visibilityOptions,
} from "../../src/lib/workflow-form-options";

describe("workflow-form-options", () => {
  it("exposes expected provider labels and provider options", () => {
    expect(providerLabels.n8n).toBe("n8n");
    expect(providerLabels.make).toBe("Make.com");
    expect(providerLabels.custom).toBe("Custom");

    const providerValues = providerOptions.map((option) => option.value);
    expect(providerValues).toEqual(["n8n", "zapier", "make", "sim", "custom"]);
    expect(providerOptions.every((option) => typeof option.icon === "function")).toBeTrue();
  });

  it("keeps auth/trigger/http method options in sync with UI expectations", () => {
    expect(authTypeOptions.map((option) => option.value)).toEqual([
      "none",
      "bearer",
      "api_key",
      "header_secret",
      "custom",
    ]);
    expect(triggerMethodOptions.map((option) => option.value)).toEqual(["webhook", "api", "internal"]);
    expect(httpMethodOptions.map((option) => option.value)).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    expect(visibilityOptions.map((option) => option.value)).toEqual(["public", "private"]);
  });

  it("includes all-provider filter entry followed by concrete providers", () => {
    expect(providerFilterOptions[0]).toEqual({ value: "", label: "All Providers" });
    expect(providerFilterOptions.slice(1).map((option) => option.value)).toEqual([
      "n8n",
      "zapier",
      "make",
      "sim",
      "custom",
    ]);
  });
});
