interface SectionHeaderProps {
  title: string;
  divider?: boolean;
}

export function SectionHeader(props: SectionHeaderProps) {
  return (
    <div class={props.divider ? "pb-2 border-b border-neutral-800/70" : "pb-1"}>
      <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">{props.title}</p>
    </div>
  );
}
