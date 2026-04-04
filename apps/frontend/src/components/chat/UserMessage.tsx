import { Show, createSignal } from "solid-js";
import type { ChatAttachmentDto } from "@autopilot/shared";

/**
 * Interface describing user message props shape.
 */
interface UserMessageProps {
  content?: string;
  onEdit?: (newText: string) => void;
  textScale?: number;
  attachments?: ChatAttachmentDto[];
}

/**
 * Utility function to icon edit.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from IconEdit.
 *
 * @example
 * ```typescript
 * const output = IconEdit();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function IconEdit() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/**
 * Utility function to icon copy.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from IconCopy.
 *
 * @example
 * ```typescript
 * const output = IconCopy();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function IconCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * Utility function to icon check.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from IconCheck.
 *
 * @example
 * ```typescript
 * const output = IconCheck();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Utility function to user message.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for UserMessage.
 * @returns Return value from UserMessage.
 *
 * @example
 * ```typescript
 * const output = UserMessage(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function UserMessage(props: UserMessageProps) {
  const [editing, setEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal(props.content ?? "");
  const [copied, setCopied] = createSignal(false);
  const bubbleScaleStyle = () => {
    const scale = Math.min(130, Math.max(85, props.textScale ?? 100));
    return { "font-size": `calc(0.844rem * ${scale} / 100)` };
  };

  /**
   * Utility function to copy text.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from copyText.
   *
   * @example
   * ```typescript
   * const output = copyText();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function copyText() {
    const text = props.content?.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  /**
   * Utility function to submit edit.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from submitEdit.
   *
   * @example
   * ```typescript
   * const output = submitEdit();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function submitEdit() {
    const v = editValue().trim();
    if (v && props.onEdit) props.onEdit(v);
    setEditing(false);
  }

  return (
    <div class="group/user flex w-full justify-end mb-4">
      <div class={`flex flex-col items-end gap-2 ${editing() ? "w-full" : "max-w-[85%] md:max-w-[75%]"}`}>
        <Show
          when={!editing()}
          fallback={
            <div class="w-full flex flex-col gap-3">
              <div class="w-full bg-[#1e1e1e] border border-neutral-800/40 focus-within:border-neutral-600/50 rounded-2xl px-5 py-5 transition-all duration-200">
                <textarea
                  class="w-full min-h-[80px] max-h-[400px] bg-transparent text-sm text-neutral-100 resize-none scrollbar-custom focus:outline-none leading-relaxed block"
                  value={editValue()}
                  onInput={(e) => {
                    setEditValue(e.currentTarget.value);
                    e.currentTarget.style.height = "auto";
                    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitEdit();
                    }
                    if (e.key === "Escape") setEditing(false);
                  }}
                  ref={(el) => setTimeout(() => {
                    el?.focus();
                    if (el) el.style.height = `${el.scrollHeight}px`;
                  }, 20)}
                />
              </div>
              <div class="flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditing(false)}
                  class="text-sm px-4 py-2 rounded-xl bg-transparent border border-neutral-800/50 hover:border-neutral-700/50 text-neutral-400 hover:text-neutral-200 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={submitEdit}
                  class="text-sm px-4 py-2 rounded-xl bg-white text-black font-medium hover:bg-neutral-200 transition-all"
                >
                  Send
                </button>
              </div>
            </div>
          }
        >
          <div class="relative">
            {/* Desktop action buttons — hover-revealed, absolute left of bubble */}
            <div class="hidden md:flex absolute -left-[4.5rem] bottom-1 items-center gap-0.5 opacity-0 group-hover/user:opacity-100 transition-opacity duration-150">
              <button
                title={copied() ? "Copied" : "Copy"}
                onClick={copyText}
                class={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150 ${copied() ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-100 hover:bg-white/5"}`}
              >
                <Show when={copied()} fallback={<IconCopy />}><IconCheck /></Show>
              </button>
              <Show when={props.onEdit}>
                <button
                  title="Edit"
                  onClick={() => {
                    setEditValue(props.content ?? "");
                    setEditing(true);
                  }}
                  class="flex items-center justify-center w-7 h-7 rounded-lg text-neutral-500 hover:text-neutral-100 hover:bg-white/5 transition-all duration-150"
                >
                  <IconEdit />
                </button>
              </Show>
            </div>

            <Show when={(props.attachments || []).length > 0}>
              <div class="mb-2 flex flex-wrap gap-2 justify-end">
                {(props.attachments || []).map((att) => {
                  const isSpreadsheet = att.filename.match(/\.(csv|xlsx|xls)$/i);
                  const isImage = att.filename.match(/\.(png|jpe?g|webp|gif|svg)$/i);
                  const isPdf = att.filename.match(/\.pdf$/i);
                  const iconColor = isSpreadsheet ? "bg-emerald-500/20 text-emerald-400" : isPdf ? "bg-rose-500/20 text-rose-400" : isImage ? "bg-blue-500/20 text-blue-400" : "bg-indigo-500/20 text-indigo-400";
                  
                  return (
                    <div
                      class="relative flex items-center gap-3 bg-[#1e1e1e] border border-neutral-700/50 rounded-xl p-2 pr-4 min-w-[180px] max-w-[240px] shadow-sm text-left"
                      title={[
                        att.extractionQuality ? `Extraction: ${att.extractionQuality}` : null,
                        (att as any)?.structuredMetadata?.extractionSource ? `Source: ${(att as any).structuredMetadata.extractionSource}` : null,
                        att.extractionStats?.pages != null ? `Pages: ${att.extractionStats.pages}` : null,
                        att.extractionStats?.sheets != null ? `Sheets: ${att.extractionStats.sheets}` : null,
                        att.extractionStats?.rowsTotal != null ? `Rows total: ${att.extractionStats.rowsTotal}` : null,
                        att.extractionStats?.rowsParsed != null ? `Rows parsed: ${att.extractionStats.rowsParsed}` : null,
                        att.extractionStats?.rowsSampled != null ? `Rows sampled: ${att.extractionStats.rowsSampled}` : null,
                        att.extractionStats?.coverage ? `Coverage: ${att.extractionStats.coverage}` : null,
                      ].filter(Boolean).join("\n")}
                    >
                      <div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
                        {isSpreadsheet ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" class="opacity-90" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                        ) : isImage ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" class="opacity-90" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" class="opacity-90" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        )}
                      </div>
                      <div class="flex flex-col min-w-0 flex-1">
                        <span class="text-[13px] font-medium text-neutral-200 truncate">{att.filename}</span>
                        <div class="flex items-center gap-1.5 mt-0.5 truncate">
                          <span class="text-[9px] text-neutral-500 uppercase tracking-wider font-semibold truncate">{att.processingStatus}</span>
                          <Show when={att.extractionQuality}>
                            <span class="text-neutral-600/60 text-[10px] shrink-0">•</span>
                            <span
                              class={`text-[9px] uppercase tracking-wider font-semibold shrink-0 ${
                                att.extractionQuality === "good"
                                  ? "text-emerald-400"
                                  : att.extractionQuality === "partial"
                                    ? "text-amber-400"
                                    : "text-red-400"
                              }`}
                            >
                              {att.extractionQuality}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Show>

            <div class="bg-[#171717] border border-neutral-800/80 shadow-[0_2px_8px_rgba(0,0,0,0.1)] rounded-2xl rounded-tr-[4px] px-4 py-3 sm:px-5 sm:py-3.5 text-neutral-100 leading-[1.6] whitespace-pre-wrap break-words text-left text-[14px]" style={bubbleScaleStyle()}>
              {props.content}
            </div>

            {/* Mobile action buttons — persistent tap-friendly row below bubble */}
            <div class="flex md:hidden items-center gap-2 mt-2 justify-end">
              <button
                title={copied() ? "Copied" : "Copy"}
                onClick={copyText}
                class={`flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-150 ${copied() ? "text-emerald-400 bg-emerald-500/10" : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"}`}
              >
                <Show when={copied()} fallback={<IconCopy />}><IconCheck /></Show>
              </button>
              <Show when={props.onEdit}>
                <button
                  title="Edit"
                  onClick={() => {
                    setEditValue(props.content ?? "");
                    setEditing(true);
                  }}
                  class="flex items-center justify-center h-8 w-8 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-all duration-150"
                >
                  <IconEdit />
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
