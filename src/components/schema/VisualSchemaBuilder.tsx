import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";

import type { FieldKind, SchemaNode } from "../../types";
import {
  findNodeRecursive,
  findParentList,
  moveNodeInTree,
  removeNodeRecursive,
  updateContainerChildren,
  updateNodeRecursive,
} from "../../utils/schemaTree";

import NodeCardPreview from "./NodeCardPreview";

import NodeCard from "./NodeCard";
import SchemaToolbar from "./SchemaToolbar";

import { useWorkspaceContext } from "../../context/WorkspaceContext";

import { getNodeKindMeta } from "../../utils/nodeMeta";

export default function VisualSchemaBuilder() {
  const { nodes, setNodes, handleSaveSchema, handleLoadSchema } =
    useWorkspaceContext();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<"if" | "else" | null>(
    null,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
  );

  const [activeParentIds, setActiveParentIds] = useState<Set<string> | null>(
    null,
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    const parent = findParentList(nodes, String(active.id));
    setActiveParentIds(parent ? new Set(parent.map((n) => n.id)) : null);
  };

  const sameContainerCollision: CollisionDetection = useCallback(
    (args) => {
      const collisions = pointerWithin(args);
      if (!collisions.length || !activeParentIds) return collisions;
      return collisions.filter((c) => activeParentIds.has(String(c.id)));
    },
    [activeParentIds],
  );

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

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (over && active.id !== over.id) {
      setNodes((prev) =>
        moveNodeInTree(prev, active.id as string, over.id as string),
      );
    }
  };

  const activeNode = activeId ? findNodeRecursive(nodes, activeId) : null;

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

      <DndContext
        sensors={sensors}
        collisionDetection={sameContainerCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext
          items={nodes.map((n) => n.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2 min-h-10">
            {nodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                selectedId={selectedId}
                selectedBranch={selectedBranch}
                onSelect={(id, e) => {
                  e.stopPropagation();
                  const nextSelectedId = id === selectedId ? null : id;
                  const clickedNode = findNodeRecursive(nodes, id);
                  setSelectedId(nextSelectedId);
                  setSelectedBranch(
                    nextSelectedId && clickedNode?.kind === "if" ? "if" : null,
                  );
                }}
                onSelectBranch={(id, branch) => {
                  setSelectedId(id);
                  setSelectedBranch(branch);
                }}
                onUpdate={(id, updated) =>
                  setNodes((prev) => updateNodeRecursive(prev, id, updated))
                }
                onRemove={(id) => {
                  if (selectedId === id) setSelectedId(null);
                  setNodes((prev) => removeNodeRecursive(prev, id));
                }}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeNode ? <NodeCardPreview node={activeNode} /> : null}
        </DragOverlay>
      </DndContext>

      <SchemaToolbar
        selectedKind={selectedKind}
        onAddNode={handleAddNode}
        onClearSelection={() => setSelectedId(null)}
      />
    </div>
  );
}
