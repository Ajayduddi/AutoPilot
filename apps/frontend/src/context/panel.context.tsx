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
