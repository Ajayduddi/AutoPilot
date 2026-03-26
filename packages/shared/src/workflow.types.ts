// ─────────────────────────────────────────────────────────────
//  Workflow Domain — Enums & Literals
// ─────────────────────────────────────────────────────────────

export const WORKFLOW_PROVIDERS = ['n8n', 'zapier', 'make', 'sim', 'custom'] as const;
export type WorkflowProvider = (typeof WORKFLOW_PROVIDERS)[number];

export const WORKFLOW_VISIBILITIES = ['public', 'private'] as const;
export type WorkflowVisibility = (typeof WORKFLOW_VISIBILITIES)[number];

export const WORKFLOW_TRIGGER_METHODS = ['webhook', 'api', 'internal'] as const;
export type WorkflowTriggerMethod = (typeof WORKFLOW_TRIGGER_METHODS)[number];

export const WORKFLOW_AUTH_TYPES = ['none', 'bearer', 'api_key', 'header_secret', 'custom'] as const;
export type WorkflowAuthType = (typeof WORKFLOW_AUTH_TYPES)[number];

export const WORKFLOW_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type WorkflowHttpMethod = (typeof WORKFLOW_HTTP_METHODS)[number];

export const WORKFLOW_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'waiting_approval'] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_TRIGGER_SOURCES = ['ui', 'chat', 'assistant_action', 'api', 'system'] as const;
export type WorkflowTriggerSource = (typeof WORKFLOW_TRIGGER_SOURCES)[number];

// ─────────────────────────────────────────────────────────────
//  Workflow Model
// ─────────────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  provider: WorkflowProvider;
  visibility: WorkflowVisibility;
  ownerUserId: string | null;
  enabled: boolean;
  archived: boolean;
  triggerMethod: WorkflowTriggerMethod;
  executionEndpoint: string | null;
  httpMethod: WorkflowHttpMethod;
  authType: WorkflowAuthType;
  authConfig: Record<string, unknown> | null;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  version: number;
  requiresApproval: boolean;
  lastRunAt: string | null;
  lastRunStatus: WorkflowRunStatus | null;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Workflow Run Model
// ─────────────────────────────────────────────────────────────

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowKey: string;
  provider: WorkflowProvider;
  traceId: string;
  userId: string;
  threadId: string | null;
  triggerSource: WorkflowTriggerSource;
  status: WorkflowRunStatus;
  inputPayload: Record<string, unknown> | null;
  normalizedOutput: NormalizedResult | null;
  rawProviderResponse: Record<string, unknown> | null;
  errorPayload: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Execution Contract — Request
// ─────────────────────────────────────────────────────────────

export interface WorkflowExecutionRequest {
  traceId: string;
  workflowKey: string;
  userId: string;
  source: WorkflowTriggerSource;
  input: Record<string, unknown>;
  callbackUrl: string | null;
  meta: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
//  Execution Contract — Normalized Result
// ─────────────────────────────────────────────────────────────

export interface NormalizedResult {
  summary: string;
  data: Record<string, unknown>;
  items: unknown[];
}

export interface WorkflowExecutionResult {
  runId: string;
  workflowKey: string;
  provider: WorkflowProvider;
  status: WorkflowRunStatus;
  result: NormalizedResult | null;
  raw: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  meta: {
    startedAt: string;
    finishedAt: string | null;
    triggerSource: WorkflowTriggerSource;
    providerRunId: string | null;
  };
}

// ─────────────────────────────────────────────────────────────
//  Callback Contract — Provider → App
// ─────────────────────────────────────────────────────────────

export interface WorkflowCallbackPayload {
  traceId: string;
  workflowKey: string;
  provider: WorkflowProvider;
  status: WorkflowRunStatus;
  result: Record<string, unknown> | null;
  raw: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  meta: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
//  Provider Capabilities
// ─────────────────────────────────────────────────────────────

export interface ProviderCapabilities {
  /** Provider can return data synchronously from the trigger call */
  syncResponse: boolean;
  /** Provider supports async callback to our webhook */
  asyncCallback: boolean;
  /** We can query provider for detailed run info */
  runInspection: boolean;
  /** We can ping/test provider connectivity */
  healthCheck: boolean;
  /** Provider accepts structured input validation */
  inputValidation: boolean;
}

/** Known capability profiles per provider (v1 baseline) */
export const PROVIDER_CAPABILITIES: Record<WorkflowProvider, ProviderCapabilities> = {
  n8n: {
    syncResponse: true,
    asyncCallback: true,
    runInspection: false,
    healthCheck: false,
    inputValidation: false,
  },
  zapier: {
    syncResponse: true,
    asyncCallback: false,
    runInspection: false,
    healthCheck: false,
    inputValidation: false,
  },
  make: {
    syncResponse: true,
    asyncCallback: false,
    runInspection: false,
    healthCheck: false,
    inputValidation: false,
  },
  sim: {
    syncResponse: true,
    asyncCallback: false,
    runInspection: false,
    healthCheck: false,
    inputValidation: false,
  },
  custom: {
    syncResponse: true,
    asyncCallback: true,
    runInspection: false,
    healthCheck: false,
    inputValidation: false,
  },
};
