/**
 * @fileoverview apps/frontend/src/routes/settings.helpers.ts
 *
 * High-level purpose:
 * Frontend route module that composes page-level UI, data loading, and user flows for navigation states.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Encapsulates route-scoped layout and state transitions.
 * - Coordinates API interactions with route-specific rendering behavior.
 * - Supports responsive UX patterns for authenticated and guest flows.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Create or update route component exports for target navigation path.
 * 2. Connect route logic to frontend API helpers and shared context providers.
 * 3. Validate route behavior on desktop and mobile with route/e2e tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import type { SettingsSection } from "../components/settings/types";

/**
 * Utility function to map legacy tab.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param tab - Input value for mapLegacyTab.
 * @returns Return value from mapLegacyTab.
 *
 * @example
 * ```typescript
 * const output = mapLegacyTab(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function mapLegacyTab(tab?: string): SettingsSection | null {
  if (tab === "account") return "account";
  if (tab === "webhooks") return "webhooks";
  if (tab === "connections") return "connections";
  return null;
}

/**
 * Utility function to normalize section.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param section - Input value for normalizeSection.
 * @returns Return value from normalizeSection.
 *
 * @example
 * ```typescript
 * const output = normalizeSection(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function normalizeSection(section?: string | null): SettingsSection {
  if (section === "account" || section === "webhooks" || section === "connections") return section;
  return "connections";
}

/**
 * Utility function to first param.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for firstParam.
 * @returns Return value from firstParam.
 *
 * @example
 * ```typescript
 * const output = firstParam(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
