import { Bot, Code2, Settings } from "lucide-react";
import { tabSlot } from "../types";

interface SidebarProps {
  activeTab: tabSlot;
  onSelectTab: (tab: tabSlot) => void;
}

const ACTIVE_TAB_STYLE =
  "text-(--text-primary) border-(--accent) bg-(--bg-primary)";
const INACTIVE_TAB_STYLE =
  "text-(--text-muted) border-transparent hover:text-(--text-primary) hover:bg-(--bg-tertiary)";

export default function Sidebar({ activeTab, onSelectTab }: SidebarProps) {
  return (
    <aside className="w-14 h-full shrink-0 border-r border-(--border) bg-background flex flex-col items-center py-3 space-y-2 select-none">
      <button
        onClick={() => onSelectTab("editor")}
        className={`p-2.5 rounded-lg transition-colors ${
          activeTab === "editor" ? ACTIVE_TAB_STYLE : INACTIVE_TAB_STYLE
        }`}
        title="Editor"
      >
        <Code2 className="w-5 h-5" />
      </button>

      <button
        onClick={() => onSelectTab("chat")}
        className={`p-2.5 rounded-lg transition-colors ${
          activeTab === "chat" ? ACTIVE_TAB_STYLE : INACTIVE_TAB_STYLE
        }`}
        title="AI Chat"
      >
        <Bot className="w-5 h-5" />
      </button>

      <button
        onClick={() => onSelectTab("settings")}
        className={`p-2.5 rounded-lg transition-colors mt-auto ${
          activeTab === "settings" ? ACTIVE_TAB_STYLE : INACTIVE_TAB_STYLE
        }`}
        title="Settings"
      >
        <Settings className="w-5 h-5" />
      </button>
    </aside>
  );
}
