/**
 * @fileoverview Safe markdown rendering wrapper used across chat responses.
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
import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { SolidMarkdown } from "solid-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { normalizeFencedHtmlBlocks, normalizeLooseListMarkdown } from "./markdown-normalize";

interface MarkdownContentProps {
  content: string;
}

const MAX_COPY_CHARS = 120_000;
const TABLE_PROGRESSIVE_THRESHOLD = 40;
const TABLE_PROGRESSIVE_STEP = 80;
const TABLE_VERY_LARGE_THRESHOLD = 700;
const semanticColumnClassCache = new Map<string, string[]>();

/**
 * Caps clipboard payload length for very large markdown/table content.
 */
function capCopyPayload(value: string): { text: string; truncated: boolean } {
  const text = String(value || "");
  if (text.length <= MAX_COPY_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_COPY_CHARS), truncated: true };
}

/**
 * Safe markdown rendering component with syntax highlight, copy affordances,
 * and progressive large-table rendering.
 *
 * @remarks
 * HTML is skipped by design and fenced-html-like content is normalized before
 * render to reduce unsafe output shape variability.
 */
export function MarkdownContent(props: MarkdownContentProps) {
  const content = createMemo(() => normalizeLooseListMarkdown(normalizeFencedHtmlBlocks(props.content ?? "")));
  const getSemanticColumnClass = (label: string) => {
    const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalized) return "";
    if (/(^| )(link|url|website|live|demo|repo|github)( |$)/.test(normalized)) return "ai-col-link";
    if (/(^| )(description|details|summary|overview|about|responsibilities?)( |$)/.test(normalized)) return "ai-col-description";
    if (/(^| )(tech stack|stack|technology|technologies|tools)( |$)/.test(normalized)) return "ai-col-tech-stack";
    if (/(^| )(project|company|role|title|experience)( |$)/.test(normalized)) return "ai-col-primary";
    if (/(^| )(duration|timeline|period|dates?)( |$)/.test(normalized)) return "ai-col-duration";
    return "";
  };
  const Link = (linkProps: any) => {
    const href = String(linkProps.href ?? "");
    const isExternal = /^(https?:)?\/\//i.test(href);
    return (
      <a
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
      >
        {linkProps.children}
      </a>
    );
  };
  const Code = (codeProps: any) => {
    const className = codeProps.className || "";
    const inline = Boolean(codeProps.inline);
    if (inline) {
      return <code class="ai-md-inline-code">{codeProps.children}</code>;
    }
    return <code class={className}>{codeProps.children}</code>;
  };
  const Pre = (preProps: any) => {
    let preRef: HTMLPreElement | undefined;
    const [copied, setCopied] = createSignal(false);
    const classFromNode = () => {
      const classList = preProps.node?.children?.[0]?.properties?.className;
      if (Array.isArray(classList)) return classList.find((c: string) => c.startsWith("language-")) || "";
      if (typeof classList === "string") return classList;
      return "";
    };
    const language = () => {
      const raw = classFromNode().replace("language-", "").trim();
      return raw || "text";
    };
    const copyCode = async () => {
      const text = preRef?.textContent?.trim();
      if (!text) return;
      const capped = capCopyPayload(text);
      await navigator.clipboard.writeText(capped.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    };

    return (
      <div class="ai-md-code-shell">
        <div class="ai-md-code-header">
          <span class="ai-md-code-language">{language()}</span>
          <button type="button" class="ai-md-code-copy" onClick={copyCode}>
            {copied() ? "Copied" : "Copy"}
          </button>
        </div>
        <pre ref={preRef}>{preProps.children}</pre>
      </div>
    );
  };
  const Table = (tableProps: any) => {
    let tableRef: HTMLTableElement | undefined;
    const [copied, setCopied] = createSignal(false);
    const [copiedTruncated, setCopiedTruncated] = createSignal(false);
    const [visibleRows, setVisibleRows] = createSignal<number>(Number.POSITIVE_INFINITY);
    const [totalRows, setTotalRows] = createSignal(0);

    createEffect(() => {
      if (!tableRef) return;
      queueMicrotask(() => {
        if (!tableRef) return;
        const headerCells = Array.from(tableRef.querySelectorAll("thead th"));
        if (!headerCells.length) return;
        const headerKey = headerCells.map((cell) => (cell.textContent || "").trim().toLowerCase()).join("|");
        const semanticClasses = semanticColumnClassCache.get(headerKey) || headerCells.map((cell) =>
          getSemanticColumnClass((cell.textContent || "").trim()),
        );
        if (!semanticColumnClassCache.has(headerKey)) {
          semanticColumnClassCache.set(headerKey, semanticClasses);
        }

        semanticClasses.forEach((className, index) => {
          if (!className) return;
          tableRef!.querySelectorAll(`tr > *:nth-child(${index + 1})`).forEach((cell) => {
            cell.classList.add(className);
          });
        });
        const rows = Array.from(tableRef.querySelectorAll("tbody tr"));
        const count = rows.length;
        setTotalRows(count);

        if (count > TABLE_VERY_LARGE_THRESHOLD) {
          setVisibleRows(Math.min(TABLE_PROGRESSIVE_THRESHOLD, 24));
        } else if (count > TABLE_PROGRESSIVE_THRESHOLD) {
          setVisibleRows(TABLE_PROGRESSIVE_THRESHOLD);
        } else {
          setVisibleRows(Number.POSITIVE_INFINITY);
        }
      });
    });

    createEffect(() => {
      if (!tableRef) return;
      const rows = Array.from(tableRef.querySelectorAll("tbody tr"));
      const maxVisible = visibleRows();
      rows.forEach((row, index) => {
        (row as HTMLElement).style.display = index < maxVisible ? "" : "none";
      });
    });
    const copyTable = async () => {
      if (!tableRef) return;
      const rows = Array.from(tableRef.querySelectorAll("tr"));
      const tsv = rows.map(row => {
        return Array.from(row.querySelectorAll("th, td"))
          .map(cell => (cell as HTMLElement).innerText.trim().replace(/\n/g, " "))
          .join("\t");
      }).join("\n");
      const capped = capCopyPayload(tsv);
      await navigator.clipboard.writeText(capped.text);
      setCopiedTruncated(capped.truncated);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    };

    return (
      <div class="relative group/table my-8">
        <div class="absolute right-0 -top-3 -translate-y-full z-10 opacity-0 group-hover/table:opacity-100 transition-opacity duration-200">
          <button 
            type="button" 
            class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-neutral-400 hover:text-neutral-100 bg-[#2a2a2c] hover:bg-[#323235] py-1.5 px-3 rounded-lg transition-colors border border-neutral-700/60 shadow-lg" 
            onClick={copyTable}
            title={copiedTruncated() ? "Copy Data (truncated)" : "Copy Data"}
          >
            {copied() ? (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="text-emerald-400" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> {copiedTruncated() ? "Copied (trimmed)" : "Copied"}</>
            ) : (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy Data</>
            )}
          </button>
        </div>
        <div class="ai-md-table-wrap">
          <table ref={tableRef}>{tableProps.children}</table>
        </div>
        <Show when={Number.isFinite(visibleRows()) && totalRows() > (visibleRows() as number)}>
          <div class="mt-2 flex justify-center">
            <button
              type="button"
              class="text-[11px] uppercase tracking-wider font-semibold text-neutral-400 hover:text-neutral-100 bg-[#2a2a2c] hover:bg-[#323235] py-1.5 px-3 rounded-lg transition-colors border border-neutral-700/60"
              onClick={() => setVisibleRows((prev) => prev + TABLE_PROGRESSIVE_STEP)}
            >
              Show More Rows ({Math.max(0, totalRows() - (visibleRows() as number))} remaining)
            </button>
          </div>
        </Show>
      </div>
    );
  };

  return (
    <div class="markdown-body ai-markdown">
      <SolidMarkdown
        children={content()}
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: Link,
          code: Code,
          pre: Pre,
          table: Table,
        }}
      />
    </div>
  );
}
