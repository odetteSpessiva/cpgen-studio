import { describe, expect, it } from "vitest";

import { CATEGORY_COLORS, getNodeKindMeta } from "../../../src/utils/nodeMeta";

describe("nodeMeta", () => {
  it("uses primitive metadata for variable-bearing primitive nodes", () => {
    const meta = getNodeKindMeta("float");

    expect(meta.color).toBe(CATEGORY_COLORS.primitive);
    expect(meta.headerPlaceholder).toBe("Var (e.g. N)");
    expect(
      meta.getHeaderValue?.({
        id: "float-1",
        kind: "float",
        varName: "value",
        min: "0",
        max: "1",
      }),
    ).toBe("value");
    expect(meta.setHeaderValue?.("updated")).toEqual({ varName: "updated" });
  });

  it("exposes loop children and maps the header to count", () => {
    const meta = getNodeKindMeta("loop");

    expect(meta.color).toBe(CATEGORY_COLORS.control);
    expect(meta.hasChildren).toBe(true);
    expect(meta.headerPlaceholder).toBe("Count (e.g. T)");
    expect(
      meta.getHeaderValue?.({
        id: "loop-1",
        kind: "loop",
        count: "T",
        children: [],
      }),
    ).toBe("T");
    expect(meta.setHeaderValue?.("N")).toEqual({ count: "N" });
  });

  it("keeps category colors distinct", () => {
    expect(CATEGORY_COLORS.primitive.border).not.toBe(
      CATEGORY_COLORS.collection.border,
    );
    expect(CATEGORY_COLORS.collection.border).not.toBe(
      CATEGORY_COLORS.control.border,
    );
  });
});
