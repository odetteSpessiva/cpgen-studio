import type { TreeItemComponentProps } from "dnd-kit-sortable-tree";
import { FolderTreeItemWrapper } from "dnd-kit-sortable-tree";
import {
  createContext,
  forwardRef,
  useContext,
  type ReactNode,
} from "react";
import type { SchemaNode } from "../../types";
import { getNodeKindMeta } from "../../utils/nodeMeta";
import type { SchemaTreeItemData } from "../../utils/treeAdapter";
import NodeFields from "./NodeFields";

export interface SchemaTreeItemContextValue {
  selectedId: string | null;
  collapsedIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onUpdate: (id: string, updated: Partial<SchemaNode>) => void;
}

const SchemaTreeItemContext = createContext<SchemaTreeItemContextValue | null>(
  null,
);

export function SchemaTreeItemProvider({
  value,
  children,
}: {
  value: SchemaTreeItemContextValue;
  children: ReactNode;
}) {
  return (
    <SchemaTreeItemContext.Provider value={value}>
      {children}
    </SchemaTreeItemContext.Provider>
  );
}

const SchemaTreeItemComponent = forwardRef<
  HTMLDivElement,
  TreeItemComponentProps<SchemaTreeItemData>
>((props, ref) => {
  const { item, ...wrapperProps } = props;
  const context = useContext(SchemaTreeItemContext);
  if (!context) throw new Error("SchemaTreeItemComponent requires a provider");
  const { selectedId, collapsedIds, onToggleCollapsed, onSelect, onUpdate } =
    context;

  if (item.itemKind === "branch") {
    return (
      <FolderTreeItemWrapper {...wrapperProps} item={item} ref={ref}>
        <div
          className="flex-1 py-1 text-[10px] text-(--text-muted) uppercase font-semibold"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {item.branch === "if" ? "IF" : "ELSE"}
        </div>
      </FolderTreeItemWrapper>
    );
  }

  return (
    <FolderTreeItemWrapper {...wrapperProps} item={item} ref={ref}>
      <FieldItemContent
        node={item.node}
        isSelected={selectedId === item.node.id}
        fieldsCollapsed={collapsedIds.has(item.node.id)}
        onToggleCollapsed={() => onToggleCollapsed(item.node.id)}
        onSelect={onSelect}
        onUpdate={onUpdate}
        onRemove={wrapperProps.onRemove}
      />
    </FolderTreeItemWrapper>
  );
});

SchemaTreeItemComponent.displayName = "SchemaTreeItemComponent";

export default SchemaTreeItemComponent;

function FieldItemContent({
  node,
  isSelected,
  fieldsCollapsed,
  onToggleCollapsed,
  onSelect,
  onUpdate,
  onRemove,
}: {
  node: SchemaNode;
  isSelected: boolean;
  fieldsCollapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onUpdate: (id: string, updated: Partial<SchemaNode>) => void;
  onRemove?: () => void;
}) {
  const nodeMeta = getNodeKindMeta(node.kind);
  const categoryColor = nodeMeta.color;
  const headerValue = nodeMeta.getHeaderValue?.(node);

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

  return (
    <div
      onClick={(e) => onSelect(node.id, e)}
      className="flex-1 min-w-0 bg-(--bg-tertiary) border rounded overflow-hidden shadow-sm cursor-pointer select-none"
      style={cardStyle}
    >
      <div className="flex items-center gap-2 p-2 border-b" style={headerStyle}>
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
          {!nodeMeta.hasChildren && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="text-(--text-muted) hover:text-(--text-primary) text-xs px-1 cursor-pointer"
            >
              {fieldsCollapsed ? "▶" : "▼"}
            </button>
          )}

          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-(--text-muted) hover:text-(--danger,#ef4444) px-1 py-0.5 rounded transition-colors cursor-pointer text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {!fieldsCollapsed && !nodeMeta.hasChildren && (
        <div
          className="p-2 space-y-2 text-xs"
          onPointerDown={stopInteractivePropagation}
          onClick={stopInteractivePropagation}
        >
          <NodeFields node={node} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}
