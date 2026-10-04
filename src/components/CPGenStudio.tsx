import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { tabSlot } from "../types";
import { useAIContext } from "../context/AIContext";
import type { ChatTab } from "../types";

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
  const { selectInstance, selectChatTab } = useAIContext();
  useEffect(() => {
    invoke("show_window");
  }, []);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "cpgen_main_layout",
  });

  const [activeTab, setActiveTab] = useState<tabSlot>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("cpgen_ai_instances") ?? "{}",
      ) as { activePage?: tabSlot };
      return saved.activePage ?? "editor";
    } catch {
      return "editor";
    }
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ instanceId: string; chatTab: ChatTab }>(
      "generation-notification-clicked",
      (event) => {
        selectInstance(event.payload.instanceId);
        selectChatTab(
          event.payload.chatTab === "solution" ? "solution" : "problem",
        );
        setActiveTab("chat");
        void getCurrentWindow().show();
        void getCurrentWindow().setFocus();
      },
    ).then((removeListener) => {
      unlisten = removeListener;
    });
    return () => {
      unlisten?.();
    };
  }, [selectChatTab, selectInstance]);

  useEffect(() => {
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(
        localStorage.getItem("cpgen_ai_instances") ?? "{}",
      ) as Record<string, unknown>;
    } catch {
      // Replace invalid persisted state with the current valid state.
    }
    localStorage.setItem(
      "cpgen_ai_instances",
      JSON.stringify({ ...previous, activePage: activeTab }),
    );
  }, [activeTab]);

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
