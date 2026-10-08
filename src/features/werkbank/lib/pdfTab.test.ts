import { describe, it, expect, vi } from "vitest";
import { openPendingTab, pdfBlobUrl, showInTab } from "./pdfTab";

describe("showInTab", () => {
  it("points the pending tab at the url", () => {
    const tab = { closed: false, location: { href: "" } } as unknown as Window;
    const blocked = vi.fn();
    showInTab(tab, "https://x", blocked);
    expect(tab.location.href).toBe("https://x");
    expect(blocked).not.toHaveBeenCalled();
  });
  it("does nothing when the user closed the pending tab before the PDF arrived", () => {
    const tab = { closed: true, location: { href: "" } } as unknown as Window;
    const blocked = vi.fn();
    showInTab(tab, "https://x", blocked);
    expect(blocked).not.toHaveBeenCalled();
    expect(tab.location.href).toBe("");
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

describe("pdfBlobUrl", () => {
  it("shares one pagehide listener and frees every preview url on unload", () => {
    // jsdom has no object URLs, so the test provides them.
    let n = 0;
    const create = vi.fn(() => `blob:${++n}`);
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const listen = vi.spyOn(window, "addEventListener");
    try {
      expect(pdfBlobUrl(btoa("%PDF-1"))).toBe("blob:1");
      expect(pdfBlobUrl(btoa("%PDF-2"))).toBe("blob:2");
      expect(listen.mock.calls.filter(([type]) => type === "pagehide")).toHaveLength(1);
      window.dispatchEvent(new Event("pagehide"));
      expect(revoke.mock.calls.map(([u]) => u)).toEqual(["blob:1", "blob:2"]);
    } finally {
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
      listen.mockRestore();
    }
  });
});
