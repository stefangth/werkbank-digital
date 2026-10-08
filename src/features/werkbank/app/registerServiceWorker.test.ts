import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { registerSW } = vi.hoisted(() => ({ registerSW: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW }));

type Mod = typeof import("./registerServiceWorker");

/** A fresh module per test: registration happens once per page load. */
async function load(): Promise<Mod> {
  vi.resetModules();
  return import("./registerServiceWorker");
}

async function register(mod: Mod, reload: () => void): Promise<() => void> {
  mod.registerServiceWorker(reload);
  await vi.waitFor(() => expect(registerSW).toHaveBeenCalled());
  const options = registerSW.mock.calls.at(-1)?.[0] as { onNeedReload?: () => void; immediate?: boolean };
  expect(options.immediate).toBe(true);
  expect(options.onNeedReload).toEqual(expect.any(Function));
  return options.onNeedReload as () => void;
}

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  registerSW.mockReset();
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
});
afterEach(() => {
  setHidden(false);
  window.history.pushState({}, "", "/");
});

describe("registerServiceWorker", () => {
  it("never reloads on its own while a report may be open", async () => {
    const reload = vi.fn();
    window.history.pushState({}, "", "/einsaetze/o1");
    const needReload = await register(await load(), reload);
    needReload();
    setHidden(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads on the next visit of the list page", async () => {
    const reload = vi.fn();
    window.history.pushState({}, "", "/einsaetze/o1");
    const mod = await load();
    const needReload = await register(mod, reload);
    mod.applyPendingUpdate();
    expect(reload).not.toHaveBeenCalled();
    needReload();
    window.history.pushState({}, "", "/einsaetze");
    mod.applyPendingUpdate();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when the app goes to the background on the list page", async () => {
    const reload = vi.fn();
    window.history.pushState({}, "", "/einsaetze");
    const needReload = await register(await load(), reload);
    setHidden(true);
    expect(reload).not.toHaveBeenCalled();
    setHidden(false);
    needReload();
    expect(reload).not.toHaveBeenCalled();
    setHidden(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("never reloads an office page of the same tab", async () => {
    const reload = vi.fn();
    window.history.pushState({}, "", "/einsaetze");
    const mod = await load();
    const needReload = await register(mod, reload);
    window.history.pushState({}, "", "/orders/o1");
    needReload();
    setHidden(true);
    mod.applyPendingUpdate();
    expect(reload).not.toHaveBeenCalled();
  });
});
