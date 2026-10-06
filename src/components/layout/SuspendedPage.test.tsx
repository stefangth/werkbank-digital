import { describe, it, expect } from "vitest";
import { lazy } from "react";
import { render, screen } from "@testing-library/react";
import { SuspendedPage } from "./SuspendedPage";

describe("SuspendedPage", () => {
  it("shows the page skeleton while a lazy page loads, then the page", async () => {
    let resolve: (m: { default: () => JSX.Element }) => void = () => {};
    const Page = lazy(() => new Promise<{ default: () => JSX.Element }>((r) => { resolve = r; }));
    const { container } = render(<SuspendedPage Page={Page} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    resolve({ default: () => <div>lazy page probe</div> });
    expect(await screen.findByText("lazy page probe")).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("renders an eager page directly", () => {
    render(<SuspendedPage Page={() => <div>eager page probe</div>} />);
    expect(screen.getByText("eager page probe")).toBeInTheDocument();
  });
});
