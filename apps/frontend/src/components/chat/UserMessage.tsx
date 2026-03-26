import { Show, createSignal } from "solid-js";

interface UserMessageProps {
  content?: string;
  onEdit?: (newText: string) => void;
}

function IconEdit() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function UserMessage(props: UserMessageProps) {
  const [editing, setEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal(props.content ?? "");
  const [copied, setCopied] = createSignal(false);

  function copyText() {
    const text = props.content?.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function submitEdit() {
    const v = editValue().trim();
    if (v && props.onEdit) props.onEdit(v);
    setEditing(false);
  }

  return (
    <div class="group/user flex w-full justify-end mb-2">
      <div class={`flex flex-col items-end gap-2 ${editing() ? "w-full" : "max-w-[75%]"}`}>
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
            <div class="absolute -left-[4.5rem] top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/user:opacity-100 transition-opacity duration-150">
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

            <div class="bg-[#1e1e1e] rounded-3xl px-5 py-3 text-[0.844rem] text-neutral-200 leading-[1.65] whitespace-pre-wrap break-words">
              {props.content}
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
