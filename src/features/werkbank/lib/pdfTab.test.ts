import { describe, it, expect, vi } from "vitest";
import { openPendingTab, showInTab } from "./pdfTab";

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

describe("openPendingTab", () => {
  it("cuts the opener of the new tab before it navigates", () => {
    const tab = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(tab);
    expect(openPendingTab()).toBe(tab);
    expect(tab.opener).toBeNull();
    open.mockRestore();
  });
  it("returns null when the browser refused the tab", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(openPendingTab()).toBeNull();
    open.mockRestore();
  });
});
