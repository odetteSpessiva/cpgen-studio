import { arrayMove } from "@dnd-kit/sortable";
import type { SchemaNode } from "../types";

export function isContainerNode(
  node: SchemaNode,
): node is Extract<SchemaNode, { children: SchemaNode[] }> {
  return "children" in node;
}

function getChildArrays(node: SchemaNode): SchemaNode[][] {
  if (isContainerNode(node)) return [node.children];
  if (node.kind === "if") return [node.ifChildren, node.elseChildren];
  return [];
}

export function findNodeRecursive(
  list: SchemaNode[],
  id: string,
): SchemaNode | null {
  for (const node of list) {
    if (node.id === id) return node;
    for (const children of getChildArrays(node)) {
      const found = findNodeRecursive(children, id);
      if (found) return found;
    }
  }
  return null;
}

export function removeNodeRecursive(
  list: SchemaNode[],
  id: string,
): SchemaNode[] {
  return list
    .filter((node) => node.id !== id)
    .map((node) => {
      const childArrays = getChildArrays(node);
      if (childArrays.length === 0) return node;

      if (isContainerNode(node)) {
        return { ...node, children: removeNodeRecursive(node.children, id) };
      }

      if (node.kind === "if") {
        return {
          ...node,
          ifChildren: removeNodeRecursive(node.ifChildren, id),
          elseChildren: removeNodeRecursive(node.elseChildren, id),
        };
      }

      return node;
    });
}

export function updateNodeRecursive(
  list: SchemaNode[],
  id: string,
  updated: Partial<SchemaNode>,
): SchemaNode[] {
  return list.map((node) => {
    if (node.id === id) return { ...node, ...updated } as SchemaNode;
    if (isContainerNode(node)) {
      return {
        ...node,
        children: updateNodeRecursive(node.children, id, updated),
      };
    }
    if (node.kind === "if") {
      return {
        ...node,
        ifChildren: updateNodeRecursive(node.ifChildren, id, updated),
        elseChildren: updateNodeRecursive(node.elseChildren, id, updated),
      };
    }
    return node;
  });
}

export function updateContainerChildren(
  list: SchemaNode[],
  containerId: string,
  fn: (children: SchemaNode[]) => SchemaNode[],
  branch?: "if" | "else",
): SchemaNode[] {
  return list.map((node) => {
    if (node.id === containerId && isContainerNode(node)) {
      return { ...node, children: fn(node.children) };
    }
    if (node.id === containerId && node.kind === "if" && branch) {
      return {
        ...node,
        ifChildren: branch === "if" ? fn(node.ifChildren) : node.ifChildren,
        elseChildren:
          branch === "else" ? fn(node.elseChildren) : node.elseChildren,
      };
    }
    if (isContainerNode(node)) {
      return {
        ...node,
        children: updateContainerChildren(
          node.children,
          containerId,
          fn,
          branch,
        ),
      };
    }
    if (node.kind === "if") {
      return {
        ...node,
        ifChildren: updateContainerChildren(
          node.ifChildren,
          containerId,
          fn,
          branch,
        ),
        elseChildren: updateContainerChildren(
          node.elseChildren,
          containerId,
          fn,
          branch,
        ),
      };
    }
    return node;
  });
}

function findParentArrayAndIndex(
  list: SchemaNode[],
  id: string,
): { parent: SchemaNode[]; index: number } | null {
  const idx = list.findIndex((n) => n.id === id);
  if (idx !== -1) return { parent: list, index: idx };

  for (const node of list) {
    for (const children of getChildArrays(node)) {
      const found = findParentArrayAndIndex(children, id);
      if (found) return found;
    }
  }
  return null;
}

function replaceArrayInTree(
  tree: SchemaNode[],
  targetArray: SchemaNode[],
  newArray: SchemaNode[],
): SchemaNode[] {
  if (tree === targetArray) return newArray;
  return tree.map((node) => {
    if (isContainerNode(node)) {
      return {
        ...node,
        children: replaceArrayInTree(node.children, targetArray, newArray),
      };
    }
    if (node.kind === "if") {
      return {
        ...node,
        ifChildren: replaceArrayInTree(node.ifChildren, targetArray, newArray),
        elseChildren: replaceArrayInTree(
          node.elseChildren,
          targetArray,
          newArray,
        ),
      };
    }
    return node;
  });
}

export function moveNodeInTree(
  tree: SchemaNode[],
  activeId: string,
  overId: string,
): SchemaNode[] {
  const activeLoc = findParentArrayAndIndex(tree, activeId);
  const overLoc = findParentArrayAndIndex(tree, overId);

  if (!activeLoc || !overLoc || activeLoc.parent !== overLoc.parent) {
    return tree;
  }

  const reordered = arrayMove(activeLoc.parent, activeLoc.index, overLoc.index);
  return replaceArrayInTree(tree, activeLoc.parent, reordered);
}

export function findParentList(
  list: SchemaNode[],
  id: string,
): SchemaNode[] | null {
  if (list.some((n) => n.id === id)) return list;
  for (const node of list) {
    for (const children of getChildArrays(node)) {
      const found = findParentList(children, id);
      if (found) return found;
    }
  }
  return null;
}
