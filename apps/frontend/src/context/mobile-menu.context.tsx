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
