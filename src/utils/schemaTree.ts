import { arrayMove } from "@dnd-kit/sortable";
import type { SchemaNode } from "../types";

export function findNodeRecursive(
  list: SchemaNode[],
  id: string,
): SchemaNode | null {
  for (const node of list) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeRecursive(node.children, id);
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
    .map((node) =>
      node.children
        ? { ...node, children: removeNodeRecursive(node.children, id) }
        : node,
    );
}

export function updateNodeRecursive(
  list: SchemaNode[],
  id: string,
  updated: Partial<SchemaNode>,
): SchemaNode[] {
  return list.map((node) => {
    if (node.id === id) return { ...node, ...updated } as SchemaNode;
    if (node.children) {
      return {
        ...node,
        children: updateNodeRecursive(node.children, id, updated),
      };
    }
    return node;
  });
}

export function updateContainerChildren(
  list: SchemaNode[],
  containerId: string,
  fn: (children: SchemaNode[]) => SchemaNode[],
): SchemaNode[] {
  return list.map((node) => {
    if (node.id === containerId && node.children) {
      return { ...node, children: fn(node.children) };
    }
    if (node.children) {
      return {
        ...node,
        children: updateContainerChildren(node.children, containerId, fn),
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
    if (node.children) {
      const found = findParentArrayAndIndex(node.children, id);
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
    if (node.children) {
      return {
        ...node,
        children: replaceArrayInTree(node.children, targetArray, newArray),
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
    if (node.children) {
      const found = findParentList(node.children, id);
      if (found) return found;
    }
  }
  return null;
}
