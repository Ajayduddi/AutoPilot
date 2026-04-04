// ─────────────────────────────────────────────────────────────
//  Workflow Domain — Enums & Literals
// ─────────────────────────────────────────────────────────────
export const WORKFLOW_PROVIDERS = ['n8n', 'zapier', 'make', 'sim', 'custom'] as const;
/** Supported workflow execution providers. */
export type WorkflowProvider = (typeof WORKFLOW_PROVIDERS)[number];
export const WORKFLOW_VISIBILITIES = ['public', 'private'] as const;
/** Visibility scope for workflow discovery and access. */
export type WorkflowVisibility = (typeof WORKFLOW_VISIBILITIES)[number];
export const WORKFLOW_TRIGGER_METHODS = ['webhook', 'api', 'internal'] as const;
/** Trigger mechanism configured for a workflow. */
export type WorkflowTriggerMethod = (typeof WORKFLOW_TRIGGER_METHODS)[number];
export const WORKFLOW_AUTH_TYPES = ['none', 'bearer', 'api_key', 'header_secret', 'custom'] as const;
/** Authentication strategy for outbound workflow execution calls. */
export type WorkflowAuthType = (typeof WORKFLOW_AUTH_TYPES)[number];
export const WORKFLOW_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
/** Allowed HTTP methods for execution endpoints. */
export type WorkflowHttpMethod = (typeof WORKFLOW_HTTP_METHODS)[number];
export const WORKFLOW_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'waiting_approval'] as const;
/** Lifecycle status values for workflow runs. */
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export const WORKFLOW_TRIGGER_SOURCES = ['ui', 'chat', 'assistant_action', 'api', 'system'] as const;
/** Source that initiated a workflow run. */
export type WorkflowTriggerSource = (typeof WORKFLOW_TRIGGER_SOURCES)[number];

// ─────────────────────────────────────────────────────────────
//  Workflow Model
// ─────────────────────────────────────────────────────────────

/** Canonical workflow definition record shared across backend/frontend layers. */
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

/** Optional agent-specific metadata embedded in workflow metadata blobs. */
export interface WorkflowAgentMetadata {
  agentCapabilities?: string[];
  riskLevel?: "low" | "medium" | "high";
  inputContract?: Record<string, unknown>;
  requiresApprovalOverride?: boolean;
}

// ─────────────────────────────────────────────────────────────
//  Workflow Run Model
// ─────────────────────────────────────────────────────────────

/** Persisted workflow run record. */
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

/** Normalized request contract passed to workflow providers. */
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

/** Provider-agnostic normalized result shape. */
export interface NormalizedResult {
  summary: string;
  data: Record<string, unknown>;
  items: unknown[];
}

/** Unified execution result returned by provider adapters. */
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

/** Callback payload contract used by provider webhooks. */
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

/** Capability matrix fields used for provider behavior routing. */
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
