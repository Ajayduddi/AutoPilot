import type { WorkflowDto } from "@autopilot/shared";

/**
  * workflow create form state type alias.
  */
export type WorkflowCreateFormState = {
  key: string;
  name: string;
  description: string;
  provider: string;
  visibility: string;
  triggerMethod: string;
  executionEndpoint: string;
  httpMethod: string;
  authType: string;
  tags: string;
  enabled: boolean;
  requiresApproval: boolean;
  inputSchemaJson: string;
  outputSchemaJson: string;
  bearerToken: string;
  apiKeyName: string;
  apiKeyValue: string;
  headerName: string;
  headerSecret: string;
  customAuthJson: string;
};

/**
 * Utility function to build workflow auth config.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param form - Input value for buildWorkflowAuthConfig.
 * @returns Return value from buildWorkflowAuthConfig.
 *
 * @example
 * ```typescript
 * const output = buildWorkflowAuthConfig(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function buildWorkflowAuthConfig(form: WorkflowCreateFormState): Record<string, unknown> | undefined {
  switch (form.authType) {
    case "bearer":
      return form.bearerToken ? { token: form.bearerToken } : undefined;
    case "api_key":
      return form.apiKeyValue ? { keyName: form.apiKeyName || "x-api-key", keyValue: form.apiKeyValue } : undefined;
    case "header_secret":
      return form.headerSecret ? { headerName: form.headerName || "x-secret", secret: form.headerSecret } : undefined;
    case "custom":
      try {
        const parsed = JSON.parse(form.customAuthJson) as Record<string, unknown>;
        return Object.keys(parsed).length ? parsed : undefined;
      } catch {
        return undefined;
      }
    default:
      return undefined;
  }
}

/**
 * Utility function to parse optional json.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for parseOptionalJson.
 * @param label - Input value for parseOptionalJson.
 * @returns Return value from parseOptionalJson.
 *
 * @example
 * ```typescript
 * const output = parseOptionalJson(value, value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function parseOptionalJson(value: string, label: string): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

/**
 * Utility function to compute workflow stats.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from computeWorkflowStats.
 *
 * @example
 * ```typescript
 * const output = computeWorkflowStats();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function computeWorkflowStats(
  workflows: WorkflowDto[],
  providerFilters: Array<{ value: string; label: string }>,
) {
  return {
    total: workflows.length,
    enabled: workflows.filter((w) => w.enabled && !w.archived).length,
    byProvider: providerFilters
      .slice(1)
      .map((provider) => ({
        ...provider,
        count: workflows.filter((workflow) => workflow.provider === provider.value).length,
      }))
      .filter((provider) => provider.count > 0),
  };
}
