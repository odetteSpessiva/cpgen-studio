import { useSortable } from "@dnd-kit/sortable";
import { useState } from "react";
import type { SchemaNode } from "../../types";
import { getNodeKindMeta } from "../../utils/nodeMeta";
import type { FlatNode, FlatNodeSlot } from "../../utils/schemaTree";
import FlatNodeHeader from "./FlatNodeHeader";
import NodeFields from "./NodeFields";

export const DROP_PLACEHOLDER_ID = "__drop_placeholder__";

interface FlatNodeTreeProps {
  flat: FlatNode[];
  selectedId: string | null;
  activeId: string | null;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onUpdate: (id: string, updated: Partial<SchemaNode>) => void;
  onRemove: (id: string) => void;
}

export default function FlatNodeTree({
  flat,
  selectedId,
  activeId,
  onSelect,
  onUpdate,
  onRemove,
}: FlatNodeTreeProps) {
  return <div className="space-y-2">{renderGroup(flat, 0, null, "root")}</div>;

  function renderGroup(
    entries: FlatNode[],
    startIndex: number,
    parentId: string | null,
    slot: FlatNodeSlot,
  ): React.ReactNode[] {
    const rendered: React.ReactNode[] = [];
    let i = startIndex;

    while (i < entries.length) {
      const entry = entries[i];
      if (entry.parentId !== parentId || entry.slot !== slot) break;

      if (entry.id === DROP_PLACEHOLDER_ID) {
        rendered.push(<DropIndicator key={entry.id} />);
        i++;
        continue;
      }

      rendered.push(
        <NodeBox
          key={entry.id}
          entry={entry}
          entries={entries}
          startIndex={i}
          selectedId={selectedId}
          activeId={activeId}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onRemove={onRemove}
          renderGroup={renderGroup}
        />,
      );

      i = advancePast(entries, i);
    }

    return rendered;
  }
}

function DropIndicator() {
  return (
    <div
      className="h-8 rounded border-2 border-dashed"
      style={{ borderColor: "var(--accent)" }}
    />
  );
}

function NodeBox({
  entry,
  entries,
  startIndex,
  selectedId,
  activeId,
  onSelect,
  onUpdate,
  onRemove,
  renderGroup,
}: {
  entry: FlatNode;
  entries: FlatNode[];
  startIndex: number;
  selectedId: string | null;
  activeId: string | null;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onUpdate: (id: string, updated: Partial<SchemaNode>) => void;
  onRemove: (id: string) => void;
  renderGroup: (
    entries: FlatNode[],
    startIndex: number,
    parentId: string | null,
    slot: FlatNodeSlot,
  ) => React.ReactNode[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { node } = entry;
  const nodeMeta = getNodeKindMeta(node.kind);
  const categoryColor = nodeMeta.color;
  const isSelected = selectedId === node.id;
  const isDraggingThis = activeId === node.id;
  const childSlots = nodeMeta.hasChildren ? childSlotsFor(node) : [];

  const { attributes, listeners, setNodeRef, transition } = useSortable({
    id: node.id,
  });

  const cardStyle = {
    borderColor: isSelected ? categoryColor.accent : categoryColor.border,
    boxShadow: isSelected ? `0 0 0 1px ${categoryColor.accent}` : undefined,
    transition,
    opacity: isDraggingThis ? 0.3 : 1,
  };

  const stopInteractivePropagation = (
    e: React.PointerEvent | React.MouseEvent,
  ) => {
    e.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      className="bg-(--bg-tertiary) border rounded overflow-hidden shadow-sm touch-none"
      style={cardStyle}
      {...attributes}
      {...listeners}
    >
      <FlatNodeHeader
        flat={entry}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onSelect={onSelect}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />

      {!collapsed && (
        <div
          className="p-2 space-y-2 text-xs"
          onPointerDown={stopInteractivePropagation}
        >
          {childSlots.length > 0 ? (
            childSlots.map((childSlot) => (
              <ChildSlotWrapper
                key={childSlot}
                label={childSlotLabel(node.kind, childSlot)}
              >
                {renderGroup(entries, startIndex + 1, node.id, childSlot)}
              </ChildSlotWrapper>
            ))
          ) : (
            <NodeFields node={node} onUpdate={onUpdate} />
          )}
        </div>
      )}
    </div>
  );
}

function childSlotsFor(node: SchemaNode): FlatNodeSlot[] {
  if (node.kind === "if") return ["if", "else"];
  return ["children"];
}

function childSlotLabel(kind: string, slot: FlatNodeSlot): string {
  if (slot === "if") return "IF";
  if (slot === "else") return "ELSE";
  return `${kind} container`;
}

function ChildSlotWrapper({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) && children.length > 0;

  return (
    <div
      className="p-2 rounded space-y-2 min-h-12"
      style={{ backgroundColor: "var(--bg-primary)" }}
    >
      <div className="text-[10px] text-(--text-muted) uppercase font-semibold">
        {label}
      </div>
      {hasChildren ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <div className="text-[11px] text-(--text-muted) italic text-center py-2 border border-dashed border-(--border) rounded">
          Select this to add blocks inside
        </div>
      )}
    </div>
  );
}

function advancePast(entries: FlatNode[], i: number): number {
  const id = entries[i].id;
  let j = i + 1;
  while (j < entries.length && entries[j].ancestorIds.includes(id)) {
    j++;
  }
  return j;
}
