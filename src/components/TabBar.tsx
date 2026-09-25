import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pin, X } from "lucide-react";
import { useState } from "react";
import type { WorkspaceFile } from "../types";

const TAB_CLASS =
  "h-full flex items-center min-w-0 max-w-[200px] px-3.5 border-0 border-b-2 text-[13px] overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const TAB_INACTIVE_CLASS =
  "border-transparent text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-tertiary)";
const TAB_ACTIVE_CLASS =
  "border-(--accent) text-(--text-primary) bg-(--bg-primary)";

interface PinnedTabProps {
  label: string;
  isActive: boolean;
  isDirty: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function PinnedTab({
  label,
  isActive,
  isDirty,
  disabled,
  onClick,
}: PinnedTabProps) {
  return (
    <button
      type="button"
      className={`${TAB_CLASS} gap-1.5 ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
      onClick={onClick}
      disabled={disabled}
    >
      <Pin size={11} className="shrink-0 opacity-60" />
      <span className="overflow-hidden text-ellipsis">{label}</span>
      {isDirty && <span className="ml-0.5">●</span>}
    </button>
  );
}

interface FileTabProps {
  file: WorkspaceFile;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function FileTabContent({
  file,
  isActive,
  onSelect,
  onClose,
}: Omit<FileTabProps, "onClose"> & { onClose?: () => void }) {
  return (
    <button
      type="button"
      className={`${TAB_CLASS} gap-1.5 ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
      onClick={onSelect}
    >
      <span className="overflow-hidden text-ellipsis">{file.name}</span>
      {onClose ? (
        <span
          role="button"
          tabIndex={-1}
          className="overflow-hidden text-ellipsis"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          {file.isDirty ? (
            <>
              <span className="group-hover:hidden leading-none">●</span>
              <X size={12} className="hidden group-hover:block" />
            </>
          ) : (
            <X size={12} />
          )}
        </span>
      ) : (
        file.isDirty && (
          <span className="ml-0.5 text-[10px] leading-none">●</span>
        )
      )}
    </button>
  );
}

function FileTab({ file, isActive, onSelect, onClose }: FileTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: file.path });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <FileTabContent
        file={file}
        isActive={isActive}
        onSelect={onSelect}
        onClose={onClose}
      />
    </div>
  );
}

interface TabBarProps {
  tabOrder: string[];
  openFiles: Map<string, WorkspaceFile>;
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (fromPath: string, toPath: string) => void;
  pinnedPaths: Set<string>;
}

export default function TabBar({
  tabOrder,
  openFiles,
  activePath,
  onSelect,
  onClose,
  onReorder,
  pinnedPaths,
}: TabBarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const [draggingPath, setDraggingPath] = useState<string | null>(null);

  const draggableTabs = tabOrder.filter((path) => !pinnedPaths.has(path));

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingPath(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingPath(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };

  const draggingFile = draggingPath ? openFiles.get(draggingPath) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingPath(null)}
    >
      <SortableContext
        items={draggableTabs}
        strategy={horizontalListSortingStrategy}
      >
        {draggableTabs.map((path) => {
          const file = openFiles.get(path);
          if (!file) return null;
          return (
            <FileTab
              key={path}
              file={file}
              isActive={activePath === path}
              onSelect={() => onSelect(path)}
              onClose={() => onClose(path)}
            />
          );
        })}
      </SortableContext>

      <DragOverlay>
        {draggingFile && (
          <FileTabContent
            file={draggingFile}
            isActive={activePath === draggingFile.path}
            onSelect={() => {}}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
