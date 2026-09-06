import { describe, expect, it } from "vitest";

import type { SchemaNode } from "../../../src/types";
import {
  findNodeRecursive,
  moveNodeInTree,
  removeNodeRecursive,
  updateContainerChildren,
  updateNodeRecursive,
} from "../../../src/utils/schemaTree";

describe("schemaTree", () => {
  it("updates a node recursively in nested loop children", () => {
    const tree: SchemaNode[] = [
      {
        id: "loop-1",
        kind: "loop",
        count: "T",
        children: [
          {
            id: "child-1",
            kind: "int",
            varName: "n",
            min: "1",
            max: "10",
          },
        ],
      },
    ];

    const updated = updateNodeRecursive(tree, "child-1", {
      varName: "updated",
    });

    expect(updated[0]).toMatchObject({
      kind: "loop",
      children: [
        {
          id: "child-1",
          kind: "int",
          varName: "updated",
        },
      ],
    });
  });

  it("removes a node recursively from nested loop children", () => {
    const tree: SchemaNode[] = [
      {
        id: "loop-1",
        kind: "loop",
        count: "T",
        children: [
          {
            id: "child-1",
            kind: "int",
            varName: "n",
            min: "1",
            max: "10",
          },
          {
            id: "child-2",
            kind: "string",
            varName: "s",
            length: "5",
            charset: "lowercase",
          },
        ],
      },
    ];

    const updated = removeNodeRecursive(tree, "child-1");

    expect(updated[0]).toMatchObject({
      kind: "loop",
      children: [
        {
          id: "child-2",
          kind: "string",
          varName: "s",
        },
      ],
    });
  });

  it("adds children to a loop node and finds them recursively", () => {
    const tree: SchemaNode[] = [
      {
        id: "loop-1",
        kind: "loop",
        count: "T",
        children: [],
      },
    ];

    const updated = updateContainerChildren(tree, "loop-1", (children) => [
      ...children,
      {
        id: "child-1",
        kind: "int",
        varName: "n",
        min: "1",
        max: "10",
      },
    ]);

    expect(updated[0]).toMatchObject({
      kind: "loop",
      children: [{ id: "child-1", kind: "int", varName: "n" }],
    });
    expect(findNodeRecursive(updated, "child-1")).toMatchObject({
      id: "child-1",
      kind: "int",
    });
  });

  it("reorders sibling nodes within the same parent array", () => {
    const tree: SchemaNode[] = [
      { id: "a", kind: "int", varName: "a", min: "1", max: "100" },
      { id: "b", kind: "int", varName: "b", min: "1", max: "100" },
      { id: "c", kind: "int", varName: "c", min: "1", max: "100" },
    ];

    const reordered = moveNodeInTree(tree, "a", "c");
    expect(reordered.map((node) => node.id)).toEqual(["b", "c", "a"]);
  });

  it("does not reorder nodes across different parent arrays", () => {
    const tree: SchemaNode[] = [
      {
        id: "loop-1",
        kind: "loop",
        count: "T",
        children: [
          { id: "a", kind: "int", varName: "a", min: "1", max: "100" },
        ],
      },
      { id: "b", kind: "int", varName: "b", min: "1", max: "100" },
    ];

    const unchanged = moveNodeInTree(tree, "a", "b");
    expect(unchanged).toEqual(tree);
  });

  it("updates a branch on an if node nested in a container", () => {
    const tree: SchemaNode[] = [
      {
        id: "loop-1",
        kind: "loop",
        count: "T",
        children: [
          {
            id: "if-1",
            kind: "if",
            condition: "x",
            ifChildren: [],
            elseChildren: [],
          },
        ],
      },
    ];
    const child: SchemaNode = {
      id: "child-1",
      kind: "int",
      varName: "n",
      min: "1",
      max: "10",
    };

    const updated = updateContainerChildren(
      tree,
      "if-1",
      (children) => [...children, child],
      "else",
    );

    expect(findNodeRecursive(updated, "child-1")).toMatchObject(child);
    expect(updated[0]).toMatchObject({
      children: [{ id: "if-1", ifChildren: [], elseChildren: [child] }],
    });
  });

  it("updates, removes, and reorders nodes in if branches", () => {
    const tree: SchemaNode[] = [
      {
        id: "if-1",
        kind: "if",
        condition: "x",
        ifChildren: [
          { id: "if-a", kind: "int", varName: "a", min: "1", max: "10" },
          { id: "if-b", kind: "int", varName: "b", min: "1", max: "10" },
        ],
        elseChildren: [
          {
            id: "else-a",
            kind: "string",
            varName: "s",
            length: "5",
            charset: "lowercase",
          },
        ],
      },
    ];

    const updated = updateNodeRecursive(tree, "else-a", { varName: "updated" });
    expect(findNodeRecursive(updated, "else-a")).toMatchObject({
      varName: "updated",
    });

    const reordered = moveNodeInTree(updated, "if-a", "if-b");
    expect(reordered[0]).toMatchObject({
      ifChildren: [{ id: "if-b" }, { id: "if-a" }],
    });

    const removed = removeNodeRecursive(reordered, "else-a");
    expect(removed[0]).toMatchObject({ elseChildren: [] });
  });
});
