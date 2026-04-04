import { describe, expect, it } from "bun:test";
import type { WorkflowDto } from "@autopilot/shared";
import {
  buildWorkflowAuthConfig,
  computeWorkflowStats,
  parseOptionalJson,
  type WorkflowCreateFormState,
} from "../../src/routes/workflows.helpers";

function baseForm(overrides: Partial<WorkflowCreateFormState> = {}): WorkflowCreateFormState {
  return {
    key: "wf_test",
    name: "Test",
    description: "",
    provider: "n8n",
    visibility: "private",
    triggerMethod: "webhook",
    executionEndpoint: "https://example.com",
    httpMethod: "POST",
    authType: "none",
    tags: "",
    enabled: true,
    requiresApproval: false,
    inputSchemaJson: "",
    outputSchemaJson: "",
    bearerToken: "",
    apiKeyName: "",
    apiKeyValue: "",
    headerName: "",
    headerSecret: "",
    customAuthJson: "",
    ...overrides,
  };
}

describe("workflows.helpers", () => {
  it("builds auth config for bearer/api-key/header-secret/custom", () => {
    expect(buildWorkflowAuthConfig(baseForm({ authType: "bearer", bearerToken: "tkn" }))).toEqual({
      token: "tkn",
    });
    expect(
      buildWorkflowAuthConfig(baseForm({ authType: "api_key", apiKeyName: "", apiKeyValue: "abc" })),
    ).toEqual({
      keyName: "x-api-key",
      keyValue: "abc",
    });
    expect(
      buildWorkflowAuthConfig(baseForm({ authType: "header_secret", headerName: "", headerSecret: "sec" })),
    ).toEqual({
      headerName: "x-secret",
      secret: "sec",
    });
    expect(buildWorkflowAuthConfig(baseForm({ authType: "custom", customAuthJson: '{"a":1}' }))).toEqual({ a: 1 });
  });

  it("returns undefined for empty/invalid auth values", () => {
    expect(buildWorkflowAuthConfig(baseForm({ authType: "bearer", bearerToken: "" }))).toBeUndefined();
    expect(buildWorkflowAuthConfig(baseForm({ authType: "custom", customAuthJson: "{invalid" }))).toBeUndefined();
    expect(buildWorkflowAuthConfig(baseForm({ authType: "custom", customAuthJson: "{}" }))).toBeUndefined();
  });

  it("parses optional json and throws labeled errors", () => {
    expect(parseOptionalJson("", "Input schema")).toBeUndefined();
    expect(parseOptionalJson("   ", "Input schema")).toBeUndefined();
    expect(parseOptionalJson('{"a":1}', "Input schema")).toEqual({ a: 1 });
    expect(() => parseOptionalJson("{bad", "Output schema")).toThrow("Output schema must be valid JSON");
  });

  it("computes workflow stats with enabled/non-archived and provider breakdown", () => {
    const workflows: WorkflowDto[] = [
      {
        id: "1",
        key: "wf_1",
        name: "A",
        provider: "n8n",
        executionEndpoint: "https://a",
        visibility: "private",
        enabled: true,
        archived: false,
        requiresApproval: false,
        version: 1,
        ownerUserId: "u1",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
      {
        id: "2",
        key: "wf_2",
        name: "B",
        provider: "n8n",
        executionEndpoint: "https://b",
        visibility: "private",
        enabled: false,
        archived: false,
        requiresApproval: false,
        version: 1,
        ownerUserId: "u1",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
      {
        id: "3",
        key: "wf_3",
        name: "C",
        provider: "make",
        executionEndpoint: "https://c",
        visibility: "private",
        enabled: true,
        archived: true,
        requiresApproval: false,
        version: 1,
        ownerUserId: "u1",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
      {
        id: "4",
        key: "wf_4",
        name: "D",
        provider: "zapier",
        executionEndpoint: "https://d",
        visibility: "private",
        enabled: true,
        archived: false,
        requiresApproval: false,
        version: 1,
        ownerUserId: "u1",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ];

    const stats = computeWorkflowStats(workflows, [
      { value: "all", label: "All" },
      { value: "n8n", label: "n8n" },
      { value: "zapier", label: "zapier" },
      { value: "make", label: "make" },
      { value: "custom", label: "custom" },
    ]);

    expect(stats.total).toBe(4);
    expect(stats.enabled).toBe(2);
    expect(stats.byProvider).toEqual([
      { value: "n8n", label: "n8n", count: 2 },
      { value: "zapier", label: "zapier", count: 1 },
      { value: "make", label: "make", count: 1 },
    ]);
  });
});
