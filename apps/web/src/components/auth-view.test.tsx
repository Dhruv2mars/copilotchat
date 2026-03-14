import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthView } from "./auth-view";

describe("AuthView", () => {
  it("shows hosted bridge permission guidance and status notes", () => {
    render(
      <AuthView
        bridgePermission="prompt"
        bridgeReachable={false}
        deviceAuth={null}
        isConnecting={false}
        isGrantingBridgeAccess={true}
        requestBridgeAccess={vi.fn()}
        startDeviceAuth={vi.fn()}
        statusNote="Need browser permission"
      />
    );

    expect(screen.getByRole("heading", { name: "Allow local bridge access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking bridge access..." })).toBeInTheDocument();
    expect(screen.getByText("Need browser permission")).toBeInTheDocument();
  });

  it("shows denied bridge access recovery", async () => {
    const requestBridgeAccess = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthView
        bridgePermission="denied"
        bridgeReachable={false}
        deviceAuth={null}
        isConnecting={false}
        isGrantingBridgeAccess={false}
        requestBridgeAccess={requestBridgeAccess}
        startDeviceAuth={vi.fn()}
        statusNote="Browser blocked local bridge access"
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry bridge access" }));

    expect(requestBridgeAccess).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Browser blocked local bridge access")).toBeInTheDocument();
  });

  it("hides denied bridge access notes when empty", () => {
    render(
      <AuthView
        bridgePermission="denied"
        bridgeReachable={false}
        deviceAuth={null}
        isConnecting={false}
        isGrantingBridgeAccess={false}
        requestBridgeAccess={vi.fn()}
        startDeviceAuth={vi.fn()}
        statusNote=""
      />
    );

    expect(screen.getByRole("heading", { name: "Bridge access blocked" })).toBeInTheDocument();
    expect(screen.queryByText("Browser blocked local bridge access")).toBeNull();
  });
});
