import { memo } from "react";
import type { SchemaNode } from "../../types";
import { getNodeKindMeta } from "../../utils/nodeMeta";
import type { FlatNode } from "../../utils/schemaTree";

interface FlatNodeHeaderProps {
  flat: FlatNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onUpdate: (id: string, updated: Partial<SchemaNode>) => void;
  onRemove: (id: string) => void;
}

function FlatNodeHeader({
  flat,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onUpdate,
  onRemove,
}: FlatNodeHeaderProps) {
  const { node, slot } = flat;
  const nodeMeta = getNodeKindMeta(node.kind);
  const categoryColor = nodeMeta.color;
  const headerValue = nodeMeta.getHeaderValue?.(node);

  const headerStyle = {
    backgroundColor: categoryColor.soft,
    borderBottomColor: categoryColor.border,
  };

  const kindBadgeStyle = {
    backgroundColor: categoryColor.soft,
    borderColor: categoryColor.border,
    color: categoryColor.accent,
  };

  const stopInteractivePropagation = (
    e: React.PointerEvent | React.MouseEvent,
  ) => {
    e.stopPropagation();
  };

  return (
    <div
      onClick={(e) => onSelect(node.id, e)}
      className="flex items-center gap-2 p-2 border-b cursor-pointer select-none"
      style={headerStyle}
    >
      {slot === "if" && (
        <span className="text-[10px] text-(--text-muted) uppercase font-semibold">
          IF
        </span>
      )}
      {slot === "else" && (
        <span className="text-[10px] text-(--text-muted) uppercase font-semibold">
          ELSE
        </span>
      )}

      <span
        className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border pointer-events-none"
        style={kindBadgeStyle}
      >
        {node.kind}
      </span>

      {nodeMeta.getHeaderValue && (
        <input
          type="text"
          placeholder={nodeMeta.headerPlaceholder}
          value={headerValue}
          onPointerDown={stopInteractivePropagation}
          onClick={stopInteractivePropagation}
          onChange={(e) =>
            onUpdate(node.id, nodeMeta.setHeaderValue!(e.target.value))
          }
          className="bg-(--bg-input) border border-(--border) text-(--text-primary) px-1.5 py-0.5 rounded text-xs outline-none focus:border-(--accent) cursor-text"
          style={{
            fieldSizing: "content",
            minWidth: "4rem",
            maxWidth: "min(28rem, 100%)",
          }}
        />
      )}

      <div
        className="ml-auto flex items-center gap-1"
        onPointerDown={stopInteractivePropagation}
        onClick={stopInteractivePropagation}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed();
          }}
          className="text-(--text-muted) hover:text-(--text-primary) text-xs px-1 cursor-pointer"
        >
          {collapsed ? "▶" : "▼"}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(node.id);
          }}
          className="text-(--text-muted) hover:text-(--danger,#ef4444) px-1 py-0.5 rounded transition-colors cursor-pointer text-xs"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default memo(FlatNodeHeader);
