import { createSignal, onMount, JSX, Show } from "solid-js";

/**
 * Safely defers rendering of its children until after client-side hydration.
 * Ensures that the server and initial client render exactly match (the fallback),
 * perfectly eliminating Hydration Mismatch crashes for dynamic content.
 */
export function ClientMount(props: { children: JSX.Element; fallback?: JSX.Element }) {
  const [mounted, setMounted] = createSignal(false);
  
  onMount(() => {
    // Reveal children on the first client tick
    setMounted(true);
  });

  return (
    <Show when={mounted()} fallback={props.fallback ?? null}>
      {props.children}
    </Show>
  );
}
