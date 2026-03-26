import { ParentComponent } from "solid-js";
import { PanelProvider } from "../../context/panel.context";
import { RightPanel } from "./RightPanel";

export const AppLayout: ParentComponent = (props) => {
  return (
    <PanelProvider>
        <div class="flex h-screen w-full bg-[#0a0a0a] text-neutral-100 overflow-hidden font-sans">
        {props.children}
        <RightPanel />
      </div>
    </PanelProvider>
  );
};
