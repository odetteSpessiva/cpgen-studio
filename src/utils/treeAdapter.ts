import type { TreeItem, TreeItems } from "dnd-kit-sortable-tree";
import type { SchemaNode } from "../types";
import { getNodeKindMeta } from "./nodeMeta";

export type SchemaTreeItemData =
  | { itemKind: "field"; node: SchemaNode }
  | { itemKind: "branch"; branchOf: string; branch: "if" | "else" };

export type SchemaTreeItem = TreeItem<SchemaTreeItemData>;

function branchId(nodeId: string, branch: "if" | "else"): string {
  return `${nodeId}::${branch}`;
}

export function toTreeItems(
  nodes: SchemaNode[],
  collapsedIds: Set<string> = new Set(),
): TreeItems<SchemaTreeItemData> {
  return nodes.map((node) => toTreeItem(node, collapsedIds));
}

function toTreeItem(
  node: SchemaNode,
  collapsedIds: Set<string>,
): SchemaTreeItem {
  if (node.kind === "if") {
    const ifBranchId = branchId(node.id, "if");
    const elseBranchId = branchId(node.id, "else");
    return {
      id: node.id,
      itemKind: "field",
      node,
      canHaveChildren: false,
      collapsed: collapsedIds.has(node.id),
      children: [
        {
          id: ifBranchId,
          itemKind: "branch",
          branchOf: node.id,
          branch: "if",
          canHaveChildren: true,
          disableSorting: true,
          collapsed: collapsedIds.has(ifBranchId),
          children: toTreeItems(node.ifChildren, collapsedIds),
        },
        {
          id: elseBranchId,
          itemKind: "branch",
          branchOf: node.id,
          branch: "else",
          canHaveChildren: true,
          disableSorting: true,
          collapsed: collapsedIds.has(elseBranchId),
          children: toTreeItems(node.elseChildren, collapsedIds),
        },
      ],
    };
  }

  const hasChildren = getNodeKindMeta(node.kind).hasChildren;
  return {
    id: node.id,
    itemKind: "field",
    node,
    canHaveChildren: hasChildren === true,
    collapsed: collapsedIds.has(node.id),
    children:
      hasChildren && "children" in node
        ? toTreeItems(node.children as SchemaNode[], collapsedIds)
        : [],
  };
}

export function collectCollapsedIds(
  items: TreeItems<SchemaTreeItemData>,
): Set<string> {
  const ids = new Set<string>();

  const walk = (list: TreeItems<SchemaTreeItemData>) => {
    for (const item of list) {
      if (item.collapsed) ids.add(String(item.id));
      if (item.children?.length) walk(item.children);
    }
  };

  walk(items);
  return ids;
}

export function fromTreeItems(
  items: TreeItems<SchemaTreeItemData>,
): SchemaNode[] {
  const result: SchemaNode[] = [];

  for (const item of items) {
    if (item.itemKind === "branch") {
      continue;
    }

    const { node } = item;
    const children = (item.children ?? []) as SchemaTreeItem[];

    if (node.kind === "if") {
      const ifBranch = children.find(
        (c) => c.itemKind === "branch" && c.branch === "if",
      ) as Extract<SchemaTreeItem, { itemKind: "branch" }> | undefined;
      const elseBranch = children.find(
        (c) => c.itemKind === "branch" && c.branch === "else",
      ) as Extract<SchemaTreeItem, { itemKind: "branch" }> | undefined;

      result.push({
        ...node,
        ifChildren: fromTreeItems(
          (ifBranch?.children ?? []) as TreeItems<SchemaTreeItemData>,
        ),
        elseChildren: fromTreeItems(
          (elseBranch?.children ?? []) as TreeItems<SchemaTreeItemData>,
        ),
      });
      continue;
    }

    if (getNodeKindMeta(node.kind).hasChildren && "children" in node) {
      result.push({
        ...node,
        children: fromTreeItems(children as TreeItems<SchemaTreeItemData>),
      } as SchemaNode);
      continue;
    }

    result.push(node);
  }

  return result;
}
