import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { tabSlot } from "../types";

import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from "react-resizable-panels";
import ConsoleLogs from "./ConsoleLogs";
import Chat from "./Chat";
import EditorCanvas from "./EditorCanvas";
import Settings from "./Settings";
import Sidebar from "./sideBar";

export default function CPGenStudio() {
  useEffect(() => {
    invoke("show_window");
  }, []);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "cpgen_main_layout",
  });

  const [activeTab, setActiveTab] = useState<tabSlot>("editor");

  return (
    <div className="w-full h-full min-h-0 flex flex-row overflow-hidden bg-background">
      <Sidebar activeTab={activeTab} onSelectTab={setActiveTab} />
      <div className="w-full h-full min-h-0 flex flex-col overflow-hidden">
        {activeTab === "editor" ? (
          <Group
            orientation="vertical"
            className="flex-1 min-h-0"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <Panel className="h-full">
              <EditorCanvas />
            </Panel>

            <Separator
              className="terminal-resizer"
              aria-label="Resize terminal"
            />

            <Panel
              defaultSize="220px"
              minSize="140px"
              maxSize="480px"
              groupResizeBehavior="preserve-pixel-size"
              className="h-full border-t border-(--border)"
            >
              <ConsoleLogs />
            </Panel>
          </Group>
        ) : activeTab === "chat" ? (
          <Chat />
        ) : (
          <Settings />
        )}
      </div>
    </div>
  );
}
