import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/auth/ProtectedRoute", () => ({ ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/layout/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div><nav aria-label="sidebar" />{children}</div>,
}));

import { ModuleRouteElement } from "./ModuleRouteElement";

const Page = () => <p>module page</p>;

describe("ModuleRouteElement", () => {
  it("wraps a default route in the app shell", async () => {
    render(<ModuleRouteElement route={{ path: "/x", kinds: ["handwerk"], requiredRoles: ["admin"], Page }} />);
    expect(await screen.findByText("module page")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "sidebar" })).toBeInTheDocument();
  });

  it("renders a bare route without the app shell", async () => {
    render(<ModuleRouteElement route={{ path: "/x", kinds: ["handwerk"], requiredRoles: ["admin"], shell: "bare", Page }} />);
    expect(await screen.findByText("module page")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "sidebar" })).not.toBeInTheDocument();
  });
});
