import { For, Show, createMemo, createSignal } from "solid-js";
import { MarkdownContent } from "../MarkdownContent";
import { buildNormalizedEmailDraft, splitEmbeddedEmailDrafts } from "../email/emailDraftParser";
import type { ActionItem } from "../types";

/**
  * on action type alias.
  */
type OnAction = (action: ActionItem) => void | Promise<void>;

/**
 * Utility function to email draft view.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from EmailDraftView.
 *
 * @example
 * ```typescript
 * const output = EmailDraftView();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function EmailDraftView(props: {
  subject?: string;
  body?: string;
  intro?: string;
  outro?: string;
  signature?: string[];
  onAction?: OnAction;
}) {
  const [copied, setCopied] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const normalized = createMemo(() =>
    buildNormalizedEmailDraft({
      subject: props.subject,
      body: props.body,
      intro: props.intro,
      outro: props.outro,
      signature: props.signature,
    }),
  );
  const cleanedBody = createMemo(() => normalized().sendBody);
  const trailingOutro = createMemo(() => normalized().outro);
  const sections = createMemo(() => normalized().sections);
  const copyEmail = async () => {
    const payload = normalized().copyPayload;
    if (!payload) return;
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const sendEmail = async () => {
    if (!props.onAction || sending()) return;
    setSending(true);
    try {
      await props.onAction({
        id: "send-email-draft",
        label: "Send email",
        variant: "primary",
        data: {
          subject: normalized().subject,
          body: cleanedBody(),
        },
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div class="block-enter space-y-3">
      <section class="email-draft-card">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="email-draft-label">Email</p>
          </div>
          <div class="email-draft-toolbar shrink-0">
            <button
              type="button"
              onClick={copyEmail}
              class="email-draft-icon-button"
              title="Copy email"
            >
              {copied() ? (
                <svg class="w-[18px] h-[18px] text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={sendEmail}
              disabled={sending()}
              class={`email-draft-icon-button ${sending() ? "opacity-60 cursor-wait" : ""}`}
              title="Send email"
            >
              <svg class={`w-[18px] h-[18px] ${sending() ? "animate-pulse" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
        </div>

        <div class="email-draft-subject-row">
          <span class="email-draft-subject-label">Subject</span>
          <p class="email-draft-subject-text">{normalized().subject}</p>
        </div>

        <div class="email-draft-body">
          <div class="email-draft-markdown text-neutral-100 break-words">
            <div class="email-draft-sections">
              <For each={sections()}>
                {(section) => (
                  <div class={`email-draft-section email-draft-section-${section.kind}`}>
                    <Show
                      when={section.kind !== "signature"}
                      fallback={
                        <div class="email-draft-signature-lines">
                          <For each={(section as Extract<typeof section, { kind: "signature" }>).lines}>
                            {(line) => (
                              <div class="email-draft-signature-line">
                                <MarkdownContent content={line} />
                              </div>
                            )}
                          </For>
                        </div>
                      }
                    >
                      <MarkdownContent content={(section as Exclude<typeof section, { kind: "signature" }>).markdown} />
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </section>
      <Show when={trailingOutro()}>
        <section class="email-draft-outro text-[0.95rem] leading-[1.8] text-neutral-200">
          <MarkdownContent content={trailingOutro()!} />
        </section>
      </Show>
    </div>
  );
}

/**
 * Utility function to email draft block view.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from EmailDraftBlockView.
 *
 * @example
 * ```typescript
 * const output = EmailDraftBlockView();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function EmailDraftBlockView(props: {
  subject?: string;
  body?: string;
  intro?: string;
  outro?: string;
  signature?: string[];
  separatorBefore?: string;
  onAction?: OnAction;
}) {
  const drafts = createMemo(() =>
    splitEmbeddedEmailDrafts({
      subject: props.subject,
      body: props.body,
      intro: props.intro,
      outro: props.outro,
      signature: props.signature,
      separatorBefore: props.separatorBefore,
    }),
  );

  return (
    <div class="space-y-4">
      <For each={drafts()}>
        {(draft) => (
          <div class="space-y-3">
            <Show when={draft.separatorBefore}>
              <section class="rounded-xl border border-neutral-800/60 bg-neutral-900/25 px-4 py-2.5">
                <div class="flex items-center gap-3">
                  <div class="h-px flex-1 bg-neutral-800/80" />
                  <p class="text-xs text-neutral-400 tracking-wide font-medium whitespace-nowrap">
                    {draft.separatorBefore}
                  </p>
                  <div class="h-px flex-1 bg-neutral-800/80" />
                </div>
              </section>
            </Show>
            <EmailDraftView
              subject={draft.subject}
              body={draft.body}
              intro={draft.intro}
              outro={draft.outro}
              signature={draft.signature}
              onAction={props.onAction}
            />
          </div>
        )}
      </For>
    </div>
  );
}
