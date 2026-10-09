import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("clearAssignmentCache with a store that never answers", () => {
  it("rejects after the timeout instead of holding up the sign out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("indexedDB", { open: () => ({}) });
    const { clearAssignmentCache, CLEAR_TIMEOUT_MS } = await import("./idbPersister");
    const cleared = clearAssignmentCache();
    const check = expect(cleared).rejects.toThrow("idb_timeout");
    await vi.advanceTimersByTimeAsync(CLEAR_TIMEOUT_MS);
    await check;
  });
});
