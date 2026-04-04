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
