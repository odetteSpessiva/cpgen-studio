import { describe, expect, it } from "vitest";

import type { SchemaNode } from "../../../src/types";
import {
  collectCollapsedIds,
  fromTreeItems,
  toTreeItems,
} from "../../../src/utils/treeAdapter";

describe("treeAdapter", () => {
  it("marks leaves as non-droppable and loops as droppable", () => {
    const items = toTreeItems([
      { id: "int-1", kind: "int", varName: "N", min: "1", max: "10" },
      { id: "loop-1", kind: "loop", count: "T", children: [] },
    ]);

    expect(items[0]).toMatchObject({
      id: "int-1",
      canHaveChildren: false,
      children: [],
    });
    expect(items[1]).toMatchObject({
      id: "loop-1",
      canHaveChildren: true,
      children: [],
    });
  });

  it("creates non-droppable if nodes with droppable IF and ELSE branches", () => {
    const items = toTreeItems([
      {
        id: "if-1",
        kind: "if",
        condition: "T == 1",
        ifChildren: [],
        elseChildren: [],
      },
    ]);

    const ifItem = items[0];
    const branches = ifItem.children ?? [];

    expect(ifItem).toMatchObject({
      id: "if-1",
      canHaveChildren: false,
    });
    expect(branches).toEqual([
      expect.objectContaining({
        id: "if-1::if",
        itemKind: "branch",
        branch: "if",
        branchOf: "if-1",
        canHaveChildren: true,
        disableSorting: true,
      }),
      expect.objectContaining({
        id: "if-1::else",
        itemKind: "branch",
        branch: "else",
        branchOf: "if-1",
        canHaveChildren: true,
        disableSorting: true,
      }),
    ]);
  });

  it("preserves nested collapse IDs across both if branches", () => {
    const collapsedIds = new Set(["loop-1", "if-1::else", "else-child"]);
    const items = toTreeItems(
      [
        {
          id: "loop-1",
          kind: "loop",
          count: "T",
          children: [
            {
              id: "if-1",
              kind: "if",
              condition: "T == 1",
              ifChildren: [
                {
                  id: "if-child",
                  kind: "int",
                  varName: "",
                  min: "1",
                  max: "2",
                },
              ],
              elseChildren: [
                {
                  id: "else-child",
                  kind: "string",
                  varName: "",
                  length: "5",
                  charset: "lowercase",
                },
              ],
            },
          ],
        },
      ],
      collapsedIds,
    );

    expect(collectCollapsedIds(items)).toEqual(collapsedIds);
  });

  it("round-trips loop and if children without changing schema data", () => {
    const schema: SchemaNode[] = [
      {
        id: "loop-1",
        kind: "loop",
        count: "Q",
        children: [
          {
            id: "if-1",
            kind: "if",
            condition: "T == 1",
            ifChildren: [
              { id: "if-child", kind: "int", varName: "T", min: "1", max: "2" },
            ],
            elseChildren: [
              {
                id: "else-child",
                kind: "string",
                varName: "S",
                length: "10",
                charset: "lowercase",
              },
            ],
          },
        ],
      },
    ];

    expect(fromTreeItems(toTreeItems(schema))).toEqual(schema);
  });
});
