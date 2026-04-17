/**
 * @fileoverview API base URL resolution helper for frontend runtime and tests.
 *
 * High-level purpose:
 * Frontend utility/integration module for API communication and shared client-side helper behavior.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Abstracts transport and formatting details from UI components.
 * - Provides reusable helper contracts for request/response workflows.
 * - Keeps client integration logic testable and centrally maintained.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import helper functions into components, routes, or contexts.
 * 2. Compose utilities with domain-specific UI behavior in callers.
 * 3. Update associated unit tests when changing helper contracts.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
/**
 * Resolves the frontend API base URL from environment and runtime context.
 *
 * @remarks
 * In local dev under Vite ports, this defaults to backend port 3000 to keep
 * relative API calls stable without explicit environment configuration.
 */
export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  if (typeof window !== "undefined") {
    const { protocol, hostname, port, origin } = window.location;
    const isDev = Boolean(import.meta.env.DEV);
    if (isDev && (port === "5173" || port === "4173")) {
      return `${protocol}//${hostname}:3000`;
    }
    return origin;
  }

  // SSR fallback: only use localhost in dev mode to prevent production leaks.
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
  }
  return "";
}

/**
 * Cached API base URL constant used by API client helpers.
 */
export const API_BASE_URL = getApiBaseUrl();
