import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiagnosticsView } from "./diagnostics-view";

describe("DiagnosticsView", () => {
  it("renders offline defaults and empty models", () => {
    render(
      <DiagnosticsView
        accountLabel="GitHub Copilot"
        bridgeState={{
          paired: false,
          reachable: false
        }}
        models={[]}
        runtime="bridge_offline"
      />
    );

    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getAllByText("no")).toHaveLength(2);
    expect(screen.getAllByText("unknown")).not.toHaveLength(0);
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});
