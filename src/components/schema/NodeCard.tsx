import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState } from "react";
import type { SchemaNode } from "../../types";
import { getNodeKindMeta } from "../../utils/nodeMeta";
import { isContainerNode } from "../../utils/schemaTree";
import NodeFields from "./NodeFields";

function ChildrenContainer({
  node,
  selectedId,
  selectedBranch,
  onSelect,
  onSelectBranch,
  onUpdate,
  onRemove,
}: {
  node: SchemaNode;
  selectedId: string | null;
  selectedBranch: "if" | "else" | null;
  onSelect: NodeCardProps["onSelect"];
  onSelectBranch: NodeCardProps["onSelectBranch"];
  onUpdate: NodeCardProps["onUpdate"];
  onRemove: NodeCardProps["onRemove"];
}) {
  const [showElseBranch, setShowElseBranch] = useState(
    node.kind === "if" && node.elseChildren.length > 0,
  );
  const nodeMeta = getNodeKindMeta(node.kind);
  const children = isContainerNode(node) ? node.children : [];

  const style = {
    borderLeftColor: nodeMeta.color.border,
    backgroundColor: "var(--bg-primary)",
  };

  const renderChildren = (
    branchChildren: SchemaNode[],
    label: string,
    branch?: "if" | "else",
  ) => {
    const isSelected =
      branch !== undefined &&
      selectedId === node.id &&
      selectedBranch === branch;
    const isBranch = branch !== undefined;

    return (
      <div
        className={`pl-2 border-l-2 p-2 rounded space-y-2 min-h-12 ${isSelected ? "bg-(--bg-secondary)" : "bg-(--bg-primary)"}`}
        style={
          isSelected
            ? {
                ...style,
                borderLeftColor: nodeMeta.color.accent,
                boxShadow: `inset 2px 0 0 ${nodeMeta.color.accent}`,
              }
            : style
        }
        onClick={
          isBranch
            ? (e) => {
                e.stopPropagation();
                onSelectBranch(node.id, branch);
              }
            : undefined
        }
      >
        <div className="flex items-center justify-between text-[10px] text-(--text-muted) uppercase font-semibold">
          <span>{label}</span>
          {branch === "else" && branchChildren.length === 0 && (
            <button
              type="button"
              aria-label="Hide empty ELSE branch"
              onClick={(e) => {
                e.stopPropagation();
                setShowElseBranch(false);
                onSelectBranch(node.id, "if");
              }}
              className="text-(--text-muted) hover:text-(--text-primary) px-1 cursor-pointer"
            >
              x
            </button>
          )}
        </div>
        {branchChildren.length === 0 ? (
          <div className="text-[11px] text-(--text-muted) italic text-center py-2 border border-dashed border-(--border) rounded">
            Select this to add blocks inside
          </div>
        ) : (
          <SortableContext
            items={branchChildren.map((child) => child.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {branchChildren.map((child) => (
                <NodeCard
                  key={child.id}
                  node={child}
                  selectedId={selectedId}
                  selectedBranch={selectedBranch}
                  onSelect={onSelect}
                  onSelectBranch={onSelectBranch}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                />
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    );
  };

  if (node.kind === "if") {
    const shouldShowElseBranch = showElseBranch || node.elseChildren.length > 0;

    return (
      <div className="space-y-2">
        {renderChildren(node.ifChildren, "IF", "if")}
        {shouldShowElseBranch ? (
          renderChildren(node.elseChildren, "ELSE", "else")
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowElseBranch(true);
              onSelectBranch(node.id, "else");
            }}
            className="self-start border border-dashed border-(--border) rounded px-1.5 py-0.5 text-[10px] text-(--text-muted) hover:text-(--text-primary) hover:border-(--accent) cursor-pointer transition-colors"
          >
            + ELSE
          </button>
        )}
      </div>
    );
  }

  return renderChildren(children, `${node.kind} container`);
}

interface NodeCardProps {
  node: SchemaNode;
  selectedId: string | null;
  selectedBranch: "if" | "else" | null;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onSelectBranch: (id: string, branch: "if" | "else") => void;
  onUpdate: (id: string, updated: Partial<SchemaNode>) => void;
  onRemove: (id: string) => void;
}

function NodeCard({
  node,
  selectedId,
  selectedBranch,
  onSelect,
  onSelectBranch,
  onUpdate,
  onRemove,
}: NodeCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isSelected = selectedId === node.id;
  const categoryColor = getNodeKindMeta(node.kind).color;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
  });

  const style = {
    // Translate avoids scale-stretching during reordering
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? "none" : transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 999 : "auto",
  };

  const cardStyle = {
    borderColor: isSelected ? categoryColor.accent : categoryColor.border,
    boxShadow: isSelected ? `0 0 0 1px ${categoryColor.accent}` : undefined,
  };

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

  const nodeMeta = getNodeKindMeta(node.kind);

  const headerValue = nodeMeta.getHeaderValue?.(node);

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => onSelect(node.id, e)}
      className="bg-(--bg-tertiary) border rounded overflow-hidden shadow-sm cursor-pointer select-none"
      style={{ ...style, ...cardStyle }}
    >
      {/* Entire Header Bar acts as Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="flex items-center gap-2 p-2 bg-(--bg-secondary) border-b cursor-grab active:cursor-grabbing touch-none"
        style={headerStyle}
      >
        <span className="text-(--text-muted) text-xs">⋮⋮</span>

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
              setCollapsed(!collapsed);
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

      {/* Body */}
      {!collapsed && (
        <div
          className="p-2 space-y-2 text-xs"
          onPointerDown={stopInteractivePropagation}
        >
          {nodeMeta.hasChildren ? (
            <ChildrenContainer
              node={node}
              selectedId={selectedId}
              selectedBranch={selectedBranch}
              onSelect={onSelect}
              onSelectBranch={onSelectBranch}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ) : (
            <NodeFields node={node} onUpdate={onUpdate} />
          )}
        </div>
      )}
    </div>
  );
}

export default memo(NodeCard);
