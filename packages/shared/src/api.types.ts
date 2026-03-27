export type ApiStatus = "ok" | "error";

export type PaginatedMeta = {
  limit: number;
  nextCursor: string | null;
};

export type ApiEnvelope<TData> = {
  status: ApiStatus;
  data: TData;
  meta?: Record<string, unknown>;
};

export type ApiListEnvelope<TItem> = {
  status: ApiStatus;
  data: TItem[];
  meta?: PaginatedMeta & Record<string, unknown>;
};

export type SafeUserDto = {
  id: string;
  email: string;
  name?: string | null;
};

export type AuthStateMode = "onboarding" | "login" | "authenticated";

export type AuthStateDto = {
  mode: AuthStateMode;
  user: SafeUserDto | null;
  oauth: { google: boolean };
};

export type AccountInfoDto = {
  id: string;
  name: string | null;
  email: string;
  hasPassword: boolean;
  authProvider: "password" | "google" | "hybrid";
};

export type ChatThreadDto = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageDto = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content?: string | null;
  blocks?: unknown;
  createdAt: string;
};

export type WorkflowDto = {
  id: string;
  key: string;
  workflowKey?: string;
  name: string;
  description?: string | null;
  provider: string;
  model?: string | null;
  executionEndpoint: string;
  authType?: string | null;
  authConfig?: Record<string, unknown> | null;
  visibility: "public" | "private";
  enabled: boolean;
  archived: boolean;
  triggerMethod?: string | null;
  httpMethod?: string | null;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  requiresApproval: boolean;
  version: number;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
};

export type WorkflowRunDto = {
  id: string;
  workflowId: string;
  userId: string;
  traceId?: string | null;
  status: "running" | "completed" | "failed" | "waiting_approval";
  normalizedOutput?: Record<string, unknown> | null;
  rawProviderResponse?: Record<string, unknown> | null;
  errorPayload?: Record<string, unknown> | null;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs?: number | null;
  workflowKey?: string | null;
  provider?: string | null;
  triggerSource?: string | null;
  timing?: {
    startedAt?: string | null;
    completedAt?: string | null;
    finishedAt?: string | null;
    durationMs?: number | null;
  } | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  _raw?: Record<string, unknown> | null;
};

export type NotificationDto = {
  id: string;
  userId: string;
  type: "workflow_event" | "approval_request" | "system";
  title: string;
  message?: string | null;
  runId?: string | null;
  payload?: Record<string, unknown> | null;
  readAt?: string | null;
  createdAt: string;
};

export type NotificationSseEvent =
  | { type: "ping" }
  | { type: "notification"; data: NotificationDto }
  | {
      type: "workflow_update";
      data: {
        workflowId?: string;
        runId?: string;
        status?: string;
        userId?: string;
      };
    };

export type ApprovalDto = {
  id: string;
  runId: string;
  userId: string;
  summary: string;
  details?: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
};

export type ProviderConfigDto = {
  id: string;
  provider: string;
  model?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WebhookSecretDto = {
  id: string;
  label: string;
  secretPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  status?: string;
  secret?: string;
};
