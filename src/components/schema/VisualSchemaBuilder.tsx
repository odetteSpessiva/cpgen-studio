import { confirm } from "@tauri-apps/plugin-dialog";
import { SortableTree } from "dnd-kit-sortable-tree";
import type { ItemChangedReason } from "dnd-kit-sortable-tree/dist/types";
import { useState } from "react";

import type { FieldKind, SchemaNode } from "../../types";
import {
  findNodeRecursive,
  updateContainerChildren,
  updateNodeRecursive,
} from "../../utils/schemaTree";
import {
  collectCollapsedIds,
  fromTreeItems,
  toTreeItems,
  type SchemaTreeItemData,
} from "../../utils/treeAdapter";

import SchemaToolbar from "./SchemaToolbar";
import {
  default as SchemaTreeItemComponent,
  SchemaTreeItemProvider,
} from "./SchemaTreeItem";

import { useWorkspaceContext } from "../../context/WorkspaceContext";

import { getNodeKindMeta } from "../../utils/nodeMeta";

const INDENT_WIDTH = 24;

export default function VisualSchemaBuilder() {
  const { nodes, setNodes, handleSaveSchema, handleLoadSchema } =
    useWorkspaceContext();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<"if" | "else" | null>(
    null,
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const handleItemsChanged = (
    _items: unknown,
    reason: ItemChangedReason<SchemaTreeItemData>,
  ) => {
    const items = _items as ReturnType<typeof toTreeItems>;
    setNodes(fromTreeItems(items));

    if (reason.type === "collapsed" || reason.type === "expanded") {
      const itemId = String(reason.item.id);
      setCollapsedIds((previous) => {
        const next = new Set(previous);
        if (reason.type === "collapsed") next.add(itemId);
        else next.delete(itemId);
        return next;
      });
    } else {
      setCollapsedIds(collectCollapsedIds(items));
    }

    if (reason.type === "removed" && reason.item.itemKind === "field") {
      if (selectedId === reason.item.node.id) setSelectedId(null);
    }
  };

  const selectedNode = findNodeRecursive(nodes, selectedId || "");
  const selectedKind = selectedNode?.kind || null;

  const handleAddNode = (kind: FieldKind) => {
    const id = crypto.randomUUID();
    const defaults: Record<FieldKind, SchemaNode> = {
      int: { id, kind: "int", varName: "", min: "1", max: "100" },
      float: {
        id,
        kind: "float",
        varName: "",
        min: "0.0",
        max: "1.0",
      },
      string: {
        id,
        kind: "string",
        varName: "",
        length: "10",
        charset: "lowercase",
      },
      array: {
        id,
        kind: "array",
        varName: "",
        length: "N",
        separator: "space",
        element: {
          kind: "int",
          min: "1",
          max: "100",
        },
      },
      loop: { id, kind: "loop", count: "T", children: [] },
      if: {
        id,
        kind: "if",
        condition: "",
        ifChildren: [],
        elseChildren: [],
      },
    };

    const newNode = defaults[kind];
    const isContainer =
      selectedKind !== null ? getNodeKindMeta(selectedKind).hasChildren : false;
    setNodes((prev) =>
      isContainer && selectedId
        ? updateContainerChildren(
            prev,
            selectedId,
            (c) => [...c, newNode],
            selectedBranch ?? (selectedKind === "if" ? "if" : undefined),
          )
        : [...prev, newNode],
    );
  };

  const handleSchemaLoadClick = async () => {
    const shouldLoad = await confirm(
      "Loading a schema will replace all current work in the visual builder. Continue?",
      {
        title: "Load schema",
        kind: "warning",
      },
    );
    if (!shouldLoad) return;
    void handleLoadSchema();
  };

  const treeItems = toTreeItems(nodes, collapsedIds);
  const treeItemContext = {
    selectedId,
    collapsedIds,
    onToggleCollapsed: (id: string) =>
      setCollapsedIds((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    onSelect: (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const nextSelectedId = id === selectedId ? null : id;
      const clickedNode = findNodeRecursive(nodes, id);
      setSelectedId(nextSelectedId);
      setSelectedBranch(
        nextSelectedId && clickedNode?.kind === "if" ? "if" : null,
      );
    },
    onUpdate: (id: string, updated: Partial<SchemaNode>) =>
      setNodes((previous) => updateNodeRecursive(previous, id, updated)),
  };

  return (
    <div className="space-y-3" onClick={() => setSelectedId(null)}>
      <div className="flex items-center justify-between text-(--text-muted) font-bold text-[11px] uppercase tracking-wider">
        <span>Test Structure</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSchemaLoadClick()}
            className="font-normal h-7 px-3 rounded-sm border cursor-pointer inline-flex items-center gap-1.5 text-[13px] border-(--border) text-(--text-primary) hover:bg-(--bg-tertiary)"
          >
            Load
          </button>
          <button
            type="button"
            onClick={() => void handleSaveSchema()}
            className="font-normal h-7 px-3 rounded-sm border cursor-pointer inline-flex items-center gap-1.5 text-[13px] bg-(--accent) border-(--accent) text-white hover:bg-(--accent-hover)"
          >
            Save
          </button>
        </div>
      </div>

      <div className="min-h-10">
        <SchemaTreeItemProvider value={treeItemContext}>
          <SortableTree
            items={treeItems}
            onItemsChanged={handleItemsChanged}
            indentationWidth={INDENT_WIDTH}
            dropAnimation={null}
            sortableProps={{ animateLayoutChanges: () => false }}
            dndContextProps={{
              accessibility: { restoreFocus: false },
            }}
            TreeItemComponent={SchemaTreeItemComponent}
          />
        </SchemaTreeItemProvider>
      </div>

      <SchemaToolbar
        selectedKind={selectedKind}
        onAddNode={handleAddNode}
        onClearSelection={() => setSelectedId(null)}
      />
    </div>
  );
}
