import type { ChatBlocksEnvelope } from "./chat-block.types";

/** Status discriminator used by API envelopes. */
export type ApiStatus = "ok" | "error";

/** Cursor-style pagination metadata returned by list endpoints. */
export type PaginatedMeta = {
  limit: number;
  nextCursor: string | null;
};

/** Standard envelope for object-style API responses. */
export type ApiEnvelope<TData> = {
  status: ApiStatus;
  data: TData;
  meta?: Record<string, unknown>;
};

/** Standard envelope for list-style API responses. */
export type ApiListEnvelope<TItem> = {
  status: ApiStatus;
  data: TItem[];
  meta?: PaginatedMeta & Record<string, unknown>;
};

/** Public-safe user payload returned to the client. */
export type SafeUserDto = {
  id: string;
  email: string;
  name?: string | null;
  timezone?: string | null;
};

/** High-level authentication state for boot/session checks. */
export type AuthStateMode = "onboarding" | "login" | "authenticated";

/** Response payload for auth state endpoint. */
export type AuthStateDto = {
  mode: AuthStateMode;
  user: SafeUserDto | null;
  oauth: { google: boolean };
};

/** Account profile payload used by settings/account surfaces. */
export type AccountInfoDto = {
  id: string;
  name: string | null;
  email: string;
  timezone?: string | null;
  hasPassword: boolean;
  authProvider: "password" | "google" | "hybrid";
};

/** Chat thread metadata used by thread lists and thread headers. */
export type ChatThreadDto = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

/** Chat message payload persisted and rendered in conversation views. */
export type ChatMessageDto = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content?: string | null;
  blocks?: ChatBlocksEnvelope | unknown;
  attachments?: ChatAttachmentDto[];
  createdAt: string;
};

/** Attachment lifecycle state in ingestion/extraction pipelines. */
export type AttachmentProcessingStatus =
  | "uploaded"
  | "processing"
  | "processed"
  | "failed"
  | "not_parsable";

/** Attachment metadata attached to a chat thread/message. */
export type ChatAttachmentDto = {
  id: string;
  userId: string;
  threadId?: string | null;
  messageId?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus: AttachmentProcessingStatus;
  extractedText?: string | null;
  structuredMetadata?: Record<string, unknown> | null;
  previewData?: Record<string, unknown> | null;
  error?: string | null;
  extractionQuality?: "good" | "partial" | "failed";
  extractionStats?: {
    pages?: number;
    pagesWithText?: number;
    ocrPages?: number;
    totalChars?: number;
    confidence?: number;
    sheets?: number;
    sheetsWithData?: number;
    rowsTotal?: number;
    rowsParsed?: number;
    rowsRendered?: number;
    rowsSampled?: number;
    coverage?: "full" | "partial" | "unknown";
    paragraphs?: number;
    lines?: number;
  } | null;
  createdAt: string;
  updatedAt: string;
};

/** Request payload used when posting a new chat message. */
export type SendMessagePayload = {
  role: "user" | "assistant" | "system";
  content?: string;
  providerId?: string;
  model?: string;
  attachmentIds?: string[];
};

/** Source block emitted when file-processing insights are attached to a reply. */
export type AttachmentInsightBlock = {
  type: "source";
  origin: "Processed Files";
  metadata: string[];
};

/** Option entry for an interactive multiple-choice question block. */
export type QuestionMcqOptionDto = {
  id: string;
  label: string;
  valueToSend: string;
  description?: string;
  recommended?: boolean;
};

/** DTO for interactive question blocks rendered by the chat UI. */
export type QuestionMcqBlockDto = {
  type: "question_mcq";
  questionId: string;
  prompt: string;
  options: QuestionMcqOptionDto[];
  allowFreeText?: boolean;
  expiresAt?: string;
  stale?: boolean;
  state?: "pending" | "submitting" | "answered" | "expired";
  selectedOptionId?: string | null;
  selectedValue?: string | null;
  answeredAt?: string;
  collapsed?: boolean;
  continuation?: unknown[];
};

/** Workflow definition payload used by workflow list/detail APIs. */
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
  agentMode?: "main_orchestrator";
  selectedSubagent?: { workflowId?: string; workflowKey?: string } | null;
  riskEvaluation?: { level: "low" | "medium" | "high"; reason?: string } | null;
  requiresApproval: boolean;
  version: number;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
};

/** Workflow run payload returned by execution/history APIs. */
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
  agentMode?: "main_orchestrator" | null;
  planId?: string | null;
  planStepId?: string | null;
  selectedSubagent?: string | null;
  riskEvaluation?: { level?: "low" | "medium" | "high"; reason?: string } | null;
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

/** Notification payload rendered by the notifications inbox/stream. */
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

/** Server-sent events emitted by the notifications stream endpoint. */
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

/** Approval request payload for approval inbox and workflow gates. */
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

/** Provider connection payload for model/provider settings screens. */
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

/** Webhook secret descriptor used by callback-secret management UI. */
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

/** Runtime preference payload exposed by settings/runtime endpoints. */
export type RuntimePreferencesDto = {
  approvalMode: "default" | "auto";
  forceInteractiveQuestions: boolean;
};
