import { For } from "solid-js";
import { SectionHeader } from "./SectionHeader";

interface SummaryBlockProps {
  title?: string;
  items: string[];
}

export function SummaryBlock(props: SummaryBlockProps) {
  return (
    <section class="rounded-xl bg-neutral-900/70 px-4 py-3 border border-neutral-800/70">
      <SectionHeader title={props.title || "Summary"} divider />
      <ol class="mt-2 space-y-1.5 text-sm text-neutral-200 list-decimal pl-4">
        <For each={props.items}>{(item) => <li>{item}</li>}</For>
      </ol>
    </section>
  );
}
