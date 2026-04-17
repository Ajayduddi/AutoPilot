/**
 * @fileoverview Shared chat bubble wrapper for assistant/user message variants.
 *
 * High-level purpose:
 * Reusable frontend presentation module for rendering chat, settings, and UI primitives across routes.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Encapsulates reusable UI logic behind typed component contracts.
 * - Supports composable view patterns with minimal route coupling.
 * - Balances readability and flexibility for evolving product surfaces.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import the component into route or parent composition layers.
 * 2. Pass required typed props and wire callbacks to domain actions.
 * 3. Confirm visual and interaction behavior with component tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";
import { WorkflowCard } from "./WorkflowCard";
import type { ActionItem, AssistantBlock, MessageState, TaskCardBlock, WorkflowStatus, WorkflowStatusBlock } from "./types";
import type { ChatAttachmentDto } from "@autopilot/shared";

interface MessageBubbleProps {
  messageId?: string;
  role: "user" | "assistant" | "system";
  content?: string;
  textScale?: number;
  attachments?: ChatAttachmentDto[];
  blocks?: AssistantBlock[];
  state?: MessageState;
  streamingBlockIdx?: number;
  onRetry?: () => void;
  onEdit?: (newText: string) => void;
  onTaskOpen?: (block: TaskCardBlock) => void;
  onWorkflowOpen?: (block: WorkflowStatusBlock) => void;
  onAction?: (action: ActionItem) => void | Promise<void>;
  onQuestionAnswer?: (payload: { messageId?: string; questionId: string; optionId?: string; valueToSend: string }) => void | Promise<void>;
}

/**
 * Derives a workflow status badge from plain system-text updates.
 */
function getSystemStatus(content?: string): WorkflowStatus | null {
  const lower = (content || "").toLowerCase();
  if (lower.includes("waiting for approval")) return "waiting_approval";
  if (lower.includes("workflow running")) return "running";
  if (lower.includes("workflow completed")) return "completed";
  if (lower.includes("workflow failed")) return "failed";
  return null;
}

/**
 * Best-effort extractor for run identifiers from system message text.
 */
function getRunId(content?: string) {
  const match = (content || "").match(/run[_-][a-zA-Z0-9_-]+/);
  return match?.[0] || "system-update";
}

/**
 * Role-aware message bubble dispatcher for user, assistant, and system rows.
 */
export function MessageBubble(props: MessageBubbleProps) {
  if (props.role === "user") {
    return <UserMessage content={props.content} attachments={props.attachments} onEdit={props.onEdit} textScale={props.textScale} />;
  }

  if (props.role === "system") {
    const status = getSystemStatus(props.content);
    if (status) {
      return (
        <div class="w-full">
          <WorkflowCard
            name="Workflow update"
            status={status}
            runId={getRunId(props.content)}
            timeline={props.content}
          />
        </div>
      );
    }
    return (
      <div class="w-full flex justify-center my-3">
        <span class="text-[11px] text-neutral-500 border border-neutral-800/60 px-3 py-1 rounded-full">
          {props.content}
        </span>
      </div>
    );
  }

  return (
    <AssistantMessage
      messageId={props.messageId}
      content={props.content}
      textScale={props.textScale}
      blocks={props.blocks}
      state={props.state}
      streamingBlockIdx={props.streamingBlockIdx}
      onRetry={props.onRetry}
      onTaskOpen={props.onTaskOpen}
      onWorkflowOpen={props.onWorkflowOpen}
      onAction={props.onAction}
      onQuestionAnswer={props.onQuestionAnswer}
    />
  );
}
