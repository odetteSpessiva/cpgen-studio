import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import VisualSchemaBuilder from "../../../src/components/schema/VisualSchemaBuilder";
import { ConsoleLogsProvider } from "../../../src/context/ConsoleLogsContext";
import { WorkspaceProvider } from "../../../src/context/WorkspaceContext";

function renderBuilder() {
  return render(
    <ConsoleLogsProvider>
      <WorkspaceProvider>
        <VisualSchemaBuilder />
      </WorkspaceProvider>
    </ConsoleLogsProvider>,
  );
}

describe("VisualSchemaBuilder", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "cpgen_schema_nodes",
      JSON.stringify([
        {
          id: "if-1",
          kind: "if",
          condition: "N > 0",
          ifChildren: [
            {
              id: "if-child",
              kind: "int",
              varName: "inside_if",
              min: "1",
              max: "10",
            },
          ],
          elseChildren: [
            {
              id: "else-child",
              kind: "string",
              varName: "inside_else",
              length: "5",
              charset: "lowercase",
            },
          ],
        },
      ]),
    );
  });

  it("renders both pseudo-branches with their children", () => {
    renderBuilder();

    expect(screen.getByText("IF")).toBeInTheDocument();
    expect(screen.getByText("ELSE")).toBeInTheDocument();
    expect(screen.getByDisplayValue("inside_if")).toBeInTheDocument();
    expect(screen.getByDisplayValue("inside_else")).toBeInTheDocument();
  });

  it("collapses and expands a branch without losing its child", () => {
    renderBuilder();

    const ifRow = screen.getByText("IF").closest("li");
    expect(ifRow).not.toBeNull();

    const collapseButton = ifRow!.querySelector(
      ".dnd-sortable-tree_folder_tree-item-collapse_button",
    );
    expect(collapseButton).not.toBeNull();
    fireEvent.click(collapseButton!);

    expect(screen.queryByDisplayValue("inside_if")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("inside_else")).toBeInTheDocument();

    fireEvent.click(collapseButton!);

    expect(screen.getByDisplayValue("inside_if")).toBeInTheDocument();
  });
});
