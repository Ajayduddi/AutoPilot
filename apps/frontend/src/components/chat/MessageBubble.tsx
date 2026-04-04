import { Show } from "solid-js";
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";
import { WorkflowCard } from "./WorkflowCard";
import type { ActionItem, AssistantBlock, MessageState, TaskCardBlock, WorkflowStatus, WorkflowStatusBlock } from "./types";
import type { ChatAttachmentDto } from "@autopilot/shared";

/**
 * Interface describing message bubble props shape.
 */
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
 * Utility function to get system status.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param content - Input value for getSystemStatus.
 * @returns Return value from getSystemStatus.
 *
 * @example
 * ```typescript
 * const output = getSystemStatus(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
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
 * Utility function to get run id.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param content - Input value for getRunId.
 * @returns Return value from getRunId.
 *
 * @example
 * ```typescript
 * const output = getRunId(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function getRunId(content?: string) {
  const match = (content || "").match(/run[_-][a-zA-Z0-9_-]+/);
  return match?.[0] || "system-update";
}

/**
 * Utility function to message bubble.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for MessageBubble.
 * @returns Return value from MessageBubble.
 *
 * @example
 * ```typescript
 * const output = MessageBubble(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
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
