import { ParentComponent } from "solid-js";
import { PanelProvider } from "../../context/panel.context";
import { RightPanel } from "./RightPanel";
import { NotificationToasts } from "../notifications/NotificationToasts";

export const AppLayout: ParentComponent = (props) => {
  return (
    <PanelProvider>
      <div class="relative flex h-screen w-full bg-[#0a0a0a] text-neutral-100 overflow-hidden font-sans">
        {props.children}
        <NotificationToasts />
        <RightPanel />
      </div>
    </PanelProvider>
  );
};
