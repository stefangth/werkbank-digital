import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ui", () => ({
  MODULE_UIS: [
    {
      navItems: [],
      routes: [],
      dashboards: {},
      publicRoutes: [{ path: "/x/:token", Page: () => <p>public ok</p> }],
    },
  ],
}));

vi.mock("@/components/layout/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

import App from "@/App";

describe("module public routes", () => {
  it("renders a module public route without a session and without redirecting to login", async () => {
    window.history.pushState({}, "", "/x/abc");
    render(<App />);
    expect(await screen.findByText("public ok")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/x/abc");
    // A customer without a login must not see the app shell: no layout, sidebar or navigation.
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector("nav")).toBeNull();
  });
});
