import { JSX, createSignal, onMount, Show } from "solid-js";

/**
 * ClientOnly - renders children only after client-side hydration.
 * Prevents SSR/hydration mismatches in highly dynamic signal-driven components.
 */
export function ClientOnly(props: { children: JSX.Element; fallback?: JSX.Element }) {
  const [mounted, setMounted] = createSignal(false);
  onMount(() => setMounted(true));
  return (
    <Show when={mounted()} fallback={props.fallback ?? null}>
      {props.children}
    </Show>
  );
}
