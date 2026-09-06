import type { FieldKind, IfNode, LoopNode, SchemaNode } from "../types";

export type NodeCategory = "primitive" | "collection" | "control";

export interface NodeCategoryColor {
  border: string;
  soft: string;
  accent: string;
}

export interface NodeKindMeta {
  color: NodeCategoryColor;
  hasChildren?: boolean;
  headerField?: string;
  headerPlaceholder?: string;
  getHeaderValue?: (node: SchemaNode) => string;
  setHeaderValue?: (value: string) => Partial<SchemaNode>;
}

export const CATEGORY_COLORS: Record<NodeCategory, NodeCategoryColor> = {
  primitive: {
    border: "#60a5fa",
    soft: "rgba(96, 165, 250, 0.14)",
    accent: "#93c5fd",
  },
  collection: {
    border: "#a78bfa",
    soft: "rgba(167, 139, 250, 0.14)",
    accent: "#c4b5fd",
  },
  control: {
    border: "#fbbf24",
    soft: "rgba(251, 191, 36, 0.15)",
    accent: "#fcd34d",
  },
};

const varNameHeader: Pick<
  NodeKindMeta,
  "headerPlaceholder" | "getHeaderValue" | "setHeaderValue"
> = {
  headerPlaceholder: "Var (e.g. N)",
  getHeaderValue: (node) => node.varName ?? "",
  setHeaderValue: (value) => ({ varName: value }),
};

const NODE_KIND_META: Record<FieldKind, NodeKindMeta> = {
  int: { color: CATEGORY_COLORS.primitive, ...varNameHeader },
  float: { color: CATEGORY_COLORS.primitive, ...varNameHeader },
  string: { color: CATEGORY_COLORS.primitive, ...varNameHeader },
  array: { color: CATEGORY_COLORS.collection, ...varNameHeader },
  loop: {
    color: CATEGORY_COLORS.collection,
    hasChildren: true,
    headerPlaceholder: "Count (e.g. T)",
    getHeaderValue: (node) => (node as LoopNode).count,
    setHeaderValue: (value) => ({ count: value }) as Partial<LoopNode>,
  },
  if: {
    color: CATEGORY_COLORS.collection,
    hasChildren: true,
    headerPlaceholder: "Contition (e.g. N < 0)",
    getHeaderValue: (node) => (node as IfNode).condition,
    setHeaderValue: (value) => ({ condition: value }) as Partial<IfNode>,
  },
};

export function getNodeKindMeta(kind: FieldKind): NodeKindMeta {
  return NODE_KIND_META[kind];
}
