const SECTION_HEADING_PATTERN =
  /^(#{1,6}\s.+|(?:Profile Rating|Key Strengths|Strengths|Areas for Improvement|Final Verdict|Verdict|Next Steps|Immediate Actions|Other Helpers)\b.*)$/i;
const EMOJI_SECTION_HEADING_PATTERN =
  /^([ \t]*)([🔧📌📍✨⭐🎯🧭🛠️])\s+([A-Z][A-Za-z0-9/&()\- ]{2,80})$/u;
const LINE_BULLET_EMOJI_PATTERN = /^(?:[ \t]*)(✅|🚀|🔹|•|📝|💡|🔍|📊|📈|📌|🔧|🎯|🧭|⭐)\s+/gm;

export function formatCommonAnswerMarkdown(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const rewrittenLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const emojiHeading = trimmed.match(EMOJI_SECTION_HEADING_PATTERN);
    if (emojiHeading) {
      rewrittenLines.push(`### ${emojiHeading[2]} ${emojiHeading[3].trim()}`);
      continue;
    }
    rewrittenLines.push(line);
  }

  let normalized = rewrittenLines.join("\n");
  normalized = normalized.replace(
    /([^\n])\n(?=(#{1,6}\s|(?:Profile Rating|Key Strengths|Strengths|Areas for Improvement|Final Verdict|Verdict|Next Steps|Immediate Actions|Other Helpers)\b))/gi,
    "$1\n\n",
  );
  normalized = normalized.replace(
    /((?:Next Steps|Immediate Actions|Other Helpers):\s*)(?=(✅|🚀|🔹|•|📝|💡|🔍|📊|📈|📌|🔧|🎯|🧭|⭐))/g,
    "$1\n",
  );
  normalized = normalized.replace(
    /([.:])\s+(✅|🚀|🔹|•|📝|💡|🔍|📊|📈|📌|🔧|🎯|🧭|⭐)\s+(?=(\*\*|[A-Z]))/g,
    "$1\n$2 ",
  );
  normalized = normalized.replace(/\s+•\s+(?=[A-Z])/g, "\n• ");
  normalized = normalized.replace(LINE_BULLET_EMOJI_PATTERN, "- ");
  normalized = normalized.replace(/(^#{1,6}\s.+)\n(?!(\n|- |\d+\. |>\s|```))/gm, "$1\n");

  const spacedLines: string[] = [];
  const spacedSourceLines = normalized.split("\n");
  spacedSourceLines.forEach((line, index) => {
    const trimmed = line.trim();
    const previous = spacedLines.length ? spacedLines[spacedLines.length - 1] : "";
    if (trimmed && SECTION_HEADING_PATTERN.test(trimmed) && previous.trim() && previous.trim() !== "---") {
      spacedLines.push("");
    }
    spacedLines.push(line);
    const next = spacedSourceLines[index + 1]?.trim() ?? "";
    if (trimmed && SECTION_HEADING_PATTERN.test(trimmed) && next && next !== "") {
      spacedLines.push("");
    }
  });

  return spacedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
