/** Blinking text cursor shown while assistant is streaming text */
export function StreamingCursor() {
  return (
    <span
      class="inline-block w-[2px] h-[1.1em] align-middle ml-0.5 bg-blue-400 rounded-sm animate-pulse"
      aria-hidden="true"
    />
  );
}
