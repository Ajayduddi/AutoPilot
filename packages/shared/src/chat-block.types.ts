/** Shared fields present on all chat block payloads. */
export type ChatBlockBase = {
  type: string;
  title?: string;
};

/** High-level summary block typically rendered as bullets. */
export type SummaryBlockDto = ChatBlockBase & {
  type: "summary";
  items: string[];
};

/** Rich text markdown block. */
export type MarkdownBlockDto = ChatBlockBase & {
  type: "markdown" | "text";
  text: string;
};

/** Structured email draft block used by email composition UI. */
export type EmailDraftBlockDto = ChatBlockBase & {
  type: "email_draft";
  subject: string;
  body: string;
  label?: string;
  intro?: string;
  outro?: string;
  signature?: string[];
};

/** Answer option for interactive multiple-choice question blocks. */
export type ChatBlockQuestionMcqOption = {
  id: string;
  label: string;
  valueToSend: string;
  description?: string;
  recommended?: boolean;
};

/** Interactive question block with one selectable option response. */
export type ChatBlockQuestionMcqBlock = ChatBlockBase & {
  type: "question_mcq";
  questionId: string;
  prompt: string;
  options: ChatBlockQuestionMcqOption[];
  state?: "pending" | "submitting" | "answered" | "expired";
  selectedOptionId?: string | null;
  selectedValue?: string | null;
  continuation?: ChatBlockDto[];
};

/** Source attribution block describing where data came from. */
export type SourceBlockDto = ChatBlockBase & {
  type: "source";
  origin?: string;
  metadata?: string[];
};

/** Collapsible block for expanded execution details or diagnostics. */
export type DetailToggleBlockDto = ChatBlockBase & {
  type: "detail_toggle";
  summary: string;
  children: ChatBlockDto[];
};

/** Union of supported chat block payloads. */
export type ChatBlockDto =
  | SummaryBlockDto
  | MarkdownBlockDto
  | EmailDraftBlockDto
  | ChatBlockQuestionMcqBlock
  | SourceBlockDto
  | DetailToggleBlockDto
  | (ChatBlockBase & Record<string, unknown>);

/** Envelope wrapper used when blocks are persisted/transferred as a single object. */
export type ChatBlocksEnvelope = {
  blocks: ChatBlockDto[];
};

/**
 * Checks whether a value matches the chat blocks envelope shape.
 *
 * @remarks
 * This type guard validates only structural requirements used at runtime:
 * the top-level `blocks` property must be an array and each block must expose
 * a string `type` field.
 *
 * @param value - Unknown payload to validate.
 * @returns `true` when `value` can be treated as a {@link ChatBlocksEnvelope}.
 *
 * @example
 * ```typescript
 * const payload: unknown = { blocks: [{ type: "summary", items: ["ok"] }] };
 *
 * if (isChatBlocksEnvelope(payload)) {
 *   console.log(payload.blocks.length);
 * }
 * ```
 */
export function isChatBlocksEnvelope(value: unknown): value is ChatBlocksEnvelope {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { blocks?: unknown };
  if (!Array.isArray(maybe.blocks)) return false;
  return maybe.blocks.every((block) => !!block && typeof block === "object" && typeof (block as any).type === "string");
}
