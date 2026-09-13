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
