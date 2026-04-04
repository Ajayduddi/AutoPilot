/**
 * Interface describing section header props shape.
 */
interface SectionHeaderProps {
  title: string;
  divider?: boolean;
}

/**
 * Utility function to section header.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for SectionHeader.
 * @returns Return value from SectionHeader.
 *
 * @example
 * ```typescript
 * const output = SectionHeader(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function SectionHeader(props: SectionHeaderProps) {
  return (
    <div class={props.divider ? "pb-2 border-b border-neutral-800/70" : "pb-1"}>
      <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">{props.title}</p>
    </div>
  );
}
