// ─────────────────────────────────────────────────────────────
//  Chat roles & lifecycle
// ─────────────────────────────────────────────────────────────

export type ChatRole = "user" | "assistant" | "system";

/**
 * Lifecycle state of an assistant message.
 * "thinking"  — intent is being analyzed, no blocks yet
 * "streaming" — blocks/text are arriving progressively
 * "completed" — fully rendered, saved to DB
 * "error"     — something went wrong
 * "retrying"  — user triggered retry, same as thinking
 */
export type MessageState = "thinking" | "streaming" | "completed" | "error" | "retrying";

export type WorkflowStatus = "running" | "completed" | "failed" | "waiting_approval";

// ─────────────────────────────────────────────────────────────
//  Action contract
// ─────────────────────────────────────────────────────────────

export interface ActionItem {
  id: string;
  label: string;
  /** Button visual variant */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Icon name (simple string key, rendered by IconResolver) */
  icon?: string;
  /** Disabled — prevents click */
  disabled?: boolean;
  /** Loading — shows spinner and disables click */
  loading?: boolean;
  /** Related entity id this action targets */
  entityId?: string;
}

// ─────────────────────────────────────────────────────────────
//  Block base
// ─────────────────────────────────────────────────────────────

export interface BlockBase {
  id?: string;
  title?: string;
}

// ─────────────────────────────────────────────────────────────
//  Block types
// ─────────────────────────────────────────────────────────────

export interface MarkdownBlock extends BlockBase {
  type: "markdown";
  text: string;
}

export interface TextBlock extends BlockBase {
  type: "text";
  text: string;
}

export interface SummaryBlockData extends BlockBase {
  type: "summary";
  items: string[];
}

export interface ResultBlock extends BlockBase {
  type: "result";
  items: string[];
}

export interface SourceBlock extends BlockBase {
  type: "source";
  origin: string;
  actor?: string;
  metadata?: string[];
}

export interface ActionsBlock extends BlockBase {
  type: "actions";
  items: ActionItem[];
}

export interface TaskCardBlock extends BlockBase {
  type: "task_card";
  task: {
    title: string;
    status: string;
    source: string;
    dueDate?: string;
    description?: string;
    details?: Record<string, string>;
  };
}

export interface WorkflowStatusBlock extends BlockBase {
  type: "workflow_status";
  workflow: {
    name: string;
    status: WorkflowStatus;
    runId: string;
    startedAt?: string;
    completedAt?: string;
    timeline?: string;
    details?: Record<string, string>;
  };
}

export interface ThinkingBlock extends BlockBase {
  type: "thinking";
  label?: string;
}

/** Full-width error block shown inline inside a message */
export interface ErrorBlock extends BlockBase {
  type: "error";
  message: string;
  code?: string;
}

/** Collapsible section — summary is always visible, children revealed on click */
export interface DetailToggleBlock extends BlockBase {
  type: "detail_toggle";
  summary: string;
  children: AssistantBlock[];
}

/** Chronological event timeline */
export interface TimelineBlock extends BlockBase {
  type: "timeline";
  events: Array<{
    label: string;
    timestamp?: string;
    status?: "pending" | "active" | "done" | "failed";
  }>;
}

/** Inline approval request card */
export interface ApprovalCardBlock extends BlockBase {
  type: "approval_card";
  approvalId: string;
  summary: string;
  details?: Record<string, string>;
  status: "pending" | "approved" | "rejected";
  approveActionId?: string;
  rejectActionId?: string;
}

// ─────────────────────────────────────────────────────────────
//  Union type
// ─────────────────────────────────────────────────────────────

export type AssistantBlock =
  | MarkdownBlock
  | TextBlock
  | SummaryBlockData
  | ResultBlock
  | SourceBlock
  | ActionsBlock
  | TaskCardBlock
  | WorkflowStatusBlock
  | ThinkingBlock
  | ErrorBlock
  | DetailToggleBlock
  | TimelineBlock
  | ApprovalCardBlock;

// ─────────────────────────────────────────────────────────────
//  Message models
// ─────────────────────────────────────────────────────────────

export interface AssistantStructuredMessage {
  role: "assistant";
  blocks: AssistantBlock[];
}

/** DB-sourced message (returned from GET /messages) */
export interface ChatMessageModel {
  id: string;
  role: ChatRole;
  content?: string | null;
  blocks?: unknown;
  createdAt?: string;
}

/** Local in-flight message tracked during streaming */
export interface StreamingMessage {
  id: string;
  role: "assistant";
  state: MessageState;
  blocks: AssistantBlock[];
  /** Index of the block currently receiving streaming chunks (-1 = none) */
  streamingBlockIdx: number;
  createdAt: string;
}
