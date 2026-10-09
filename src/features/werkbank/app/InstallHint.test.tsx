import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { act } from "react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { InstallHint } from "./InstallHint";

const setUa = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
const setStandalone = (on: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("standalone"), addEventListener() {}, removeEventListener() {} }));
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

describe("InstallHint", () => {
  beforeEach(() => { localStorage.clear(); setStandalone(false); setUa("Mozilla/5.0 (Linux; Android 14) Chrome/120"); });
  afterEach(() => vi.unstubAllGlobals());

  it("is hidden when running standalone", () => {
    setStandalone(true); setUa(IOS);
    renderWithProviders(<InstallHint />);
    expect(screen.queryByText("Install the app")).not.toBeInTheDocument();
  });

  it("is hidden once dismissed", () => {
    setUa(IOS); localStorage.setItem("werkbank.installHint.dismissed", "1");
    renderWithProviders(<InstallHint />);
    expect(screen.queryByText("Install the app")).not.toBeInTheDocument();
  });

  it("shows the iOS instructions and remembers the dismissal", () => {
    setUa(IOS);
    renderWithProviders(<InstallHint />);
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Install the app")).not.toBeInTheDocument();
    expect(localStorage.getItem("werkbank.installHint.dismissed")).toBe("1");
  });

  it("calls the stored install prompt elsewhere", async () => {
    renderWithProviders(<InstallHint />);
    expect(screen.queryByText("Install the app")).not.toBeInTheDocument();
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: vi.fn().mockResolvedValue(undefined) });
    act(() => { window.dispatchEvent(ev); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Install" })); });
    expect(ev.prompt).toHaveBeenCalled();
  });

  it("survives a throwing localStorage", () => {
    setUa(IOS);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    renderWithProviders(<InstallHint />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Install the app")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
