import type { SettingsSection } from "../components/settings/types";

export function mapLegacyTab(tab?: string): SettingsSection | null {
  if (tab === "account") return "account";
  if (tab === "webhooks") return "webhooks";
  if (tab === "connections") return "connections";
  return null;
}

export function normalizeSection(section?: string | null): SettingsSection {
  if (section === "account" || section === "webhooks" || section === "connections") return section;
  return "connections";
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
