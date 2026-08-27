import { SchemaNode } from "../../types";
import { getNodeKindMeta } from "../../utils/nodeMeta";

export default function NodeCardPreview({ node }: { node: SchemaNode }) {
  const nodeMeta = getNodeKindMeta(node.kind);
  const headerValue = nodeMeta.getHeaderValue?.(node);
  const categoryColor = nodeMeta.color;

  return (
    <div
      className="bg-(--bg-tertiary) border rounded overflow-hidden shadow-lg cursor-grabbing"
      style={{ borderColor: categoryColor.border }}
    >
      <div
        className="flex items-center gap-2 p-2 bg-(--bg-secondary)"
        style={{
          backgroundColor: categoryColor.soft,
          borderBottomColor: categoryColor.border,
        }}
      >
        <span className="text-(--text-muted) text-xs">⋮⋮</span>
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border"
          style={{
            backgroundColor: categoryColor.soft,
            borderColor: categoryColor.border,
            color: categoryColor.accent,
          }}
        >
          {node.kind}
        </span>
        <span className="text-xs text-(--text-primary)">
          {headerValue || "(unnamed)"}
        </span>
      </div>
    </div>
  );
}
