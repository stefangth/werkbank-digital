import { describe, it, expect, vi } from "vitest";
import { showInTab } from "./pdfTab";

describe("showInTab", () => {
  it("points the pending tab at the url", () => {
    const tab = { closed: false, location: { href: "" } } as unknown as Window;
    const blocked = vi.fn();
    showInTab(tab, "https://x", blocked);
    expect(tab.location.href).toBe("https://x");
    expect(blocked).not.toHaveBeenCalled();
  });
  it("falls back when no tab could be opened", () => {
    const blocked = vi.fn();
    showInTab(null, "https://x", blocked);
    expect(blocked).toHaveBeenCalledWith("https://x");
  });
});
