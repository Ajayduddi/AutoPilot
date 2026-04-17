/**
 * @fileoverview apps/frontend/test/routes/settings.helpers.test.ts
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
import { firstParam, mapLegacyTab, normalizeSection } from "../../src/routes/settings.helpers";

describe("settings.helpers", () => {
  it("maps legacy tab values", () => {
    expect(mapLegacyTab("account")).toBe("account");
    expect(mapLegacyTab("connections")).toBe("connections");
    expect(mapLegacyTab("webhooks")).toBe("webhooks");
    expect(mapLegacyTab("unknown")).toBeNull();
  });

  it("normalizes unknown sections to connections", () => {
    expect(normalizeSection("account")).toBe("account");
    expect(normalizeSection("webhooks")).toBe("webhooks");
    expect(normalizeSection("connections")).toBe("connections");
    expect(normalizeSection("bad-value")).toBe("connections");
    expect(normalizeSection(undefined)).toBe("connections");
  });

  it("extracts first param value safely", () => {
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBeUndefined();
  });
});
