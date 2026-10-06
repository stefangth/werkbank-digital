import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { BRANDS, type BrandDef } from "@/lib/brand";
import { BrandMark, BrandName } from "./BrandMark";
import { StageMark } from "./StageMark";

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

beforeEach(() => vi.mocked(useBrand).mockReturnValue(BRANDS.showflow));

describe("BrandMark", () => {
  it.each([
    ["mark", 32],
    ["tile", 52],
  ] as const)("renders the same markup as StageMark for showflow (%s)", (variant, size) => {
    const brandMark = render(<BrandMark variant={variant} size={size} className="shrink-0" />);
    const stageMark = render(<StageMark variant={variant} size={size} className="shrink-0" />);
    expect(brandMark.container.innerHTML).toBe(stageMark.container.innerHTML);
  });

  it("renders the brand svg as a decorative image for a module brand", () => {
    vi.mocked(useBrand).mockReturnValue(testBrand);
    const { container } = render(<BrandMark variant="tile" size={52} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/brand/test.svg");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "52");
    expect(img).toHaveAttribute("height", "52");
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("BrandName", () => {
  it("renders the two-tone wordmark with the changelog pill for showflow", () => {
    const { container } = render(<BrandName />);
    expect(container.textContent).toContain("ShowFlow".slice(0, 4));
    expect(container.querySelector("a")).not.toBeNull();
  });

  it("renders just the brand name for a module brand", () => {
    vi.mocked(useBrand).mockReturnValue(testBrand);
    const { container } = render(<BrandName />);
    expect(container.textContent).toBe("Test Brand");
    expect(container.querySelector("a")).toBeNull();
  });
});
