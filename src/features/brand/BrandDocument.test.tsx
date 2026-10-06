import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { BRANDS, type BrandDef } from "@/lib/brand";
import BrandDocument from "./BrandDocument";

vi.mock("@/hooks/useBrand", () => ({ useBrand: vi.fn() }));
import { useBrand } from "@/hooks/useBrand";

const testBrand: BrandDef = {
  key: "test_brand",
  name: "Test Brand",
  markSvgPath: "/brand/test.svg",
  emailMarkPath: "/email/test-mark.png",
  faviconPath: "/brand/test-favicon.svg",
  appUrl: null,
  hosts: [],
  defaultFrom: null,
};

beforeEach(() => {
  document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
  document.title = "ShowFlow - Artist Booking Platform";
});

const icon = () => document.querySelector('link[rel="icon"]')?.getAttribute("href");

describe("BrandDocument", () => {
  it("leaves the index.html title and favicon alone for showflow", () => {
    vi.mocked(useBrand).mockReturnValue(BRANDS.showflow);
    render(<BrandDocument />);
    expect(document.title).toBe("ShowFlow - Artist Booking Platform");
    expect(icon()).toBe("/favicon.svg");
  });

  it("sets title and favicon for a module brand and restores them on unmount", () => {
    vi.mocked(useBrand).mockReturnValue(testBrand);
    const { unmount } = render(<BrandDocument />);
    expect(document.title).toBe("Test Brand");
    expect(icon()).toBe("/brand/test-favicon.svg");
    unmount();
    expect(document.title).toBe("ShowFlow - Artist Booking Platform");
    expect(icon()).toBe("/favicon.svg");
  });
});
