/**
 * @fileoverview apps/frontend/src/context/panel.context.tsx
 *
 * High-level purpose:
 * Frontend context module that provides shared client state and actions across multiple screens.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Centralizes cross-route state with typed provider boundaries.
 * - Reduces prop drilling for session, panel, and notification state.
 * - Improves consistency of state transitions in complex UI flows.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Wrap consuming trees with the exported provider component.
 * 2. Consume context values through typed hooks or context accessors.
 * 3. Keep side effects scoped and validated via related tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { JSX, createSignal, createContext, useContext, ParentComponent } from "solid-js";

/**
  * panel content type alias.
  */
type PanelContent = { title: string; content: JSX.Element } | null;
const PanelContext = createContext<{
  panel: () => PanelContent;
  openPanel: (content: PanelContent) => void;
  closePanel: () => void;
}>({
  panel: () => null,
  openPanel: () => {},
  closePanel: () => {},
});
export const PanelProvider: ParentComponent = (props) => {
  const [panel, setPanel] = createSignal<PanelContent>(null);
  return (
    <PanelContext.Provider value={{
      panel,
      openPanel: setPanel,
      closePanel: () => setPanel(null),
    }}>
      {props.children}
    </PanelContext.Provider>
  );
};
export const usePanel = () => useContext(PanelContext);
