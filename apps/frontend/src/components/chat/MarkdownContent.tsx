import { createMemo, createSignal } from "solid-js";
import { SolidMarkdown } from "solid-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownContentProps {
  content: string;
}

function normalizeFencedHtmlBlocks(markdown: string): string {
  return markdown.replace(/```(html|xml|xhtml|jsx|tsx)[^\n]*\r?\n([\s\S]*?)```/gi, (full, _lang, body) => {
    // Improve readability for compact markup samples like </p></div>.
    const normalizedBody = String(body).replace(/>([ \t]*)<\//g, ">\n</");
    return full.replace(body, normalizedBody);
  });
}

export function MarkdownContent(props: MarkdownContentProps) {
  const content = createMemo(() => normalizeFencedHtmlBlocks(props.content ?? ""));

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
      await navigator.clipboard.writeText(text);
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

  const Table = (tableProps: any) => (
    <div class="ai-md-table-wrap">
      <table>{tableProps.children}</table>
    </div>
  );

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
