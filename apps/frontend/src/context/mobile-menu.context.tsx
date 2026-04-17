/**
 * @fileoverview apps/frontend/src/context/mobile-menu.context.tsx
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
import { createContext, createSignal, useContext, ParentComponent } from "solid-js";

/**
 * Interface describing mobile menu state shape.
 */
interface MobileMenuState {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}
const MobileMenuContext = createContext<MobileMenuState>();
export const MobileMenuProvider: ParentComponent = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <MobileMenuContext.Provider
      value={{
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen((prev) => !prev),
      }}
    >
      {props.children}
    </MobileMenuContext.Provider>
  );
};

/**
 * Utility function to use mobile menu.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from useMobileMenu.
 *
 * @example
 * ```typescript
 * const output = useMobileMenu();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function useMobileMenu() {
  const ctx = useContext(MobileMenuContext);
  if (!ctx) throw new Error("useMobileMenu must be used within MobileMenuProvider");
  return ctx;
}
