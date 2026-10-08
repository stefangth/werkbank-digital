import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { assignmentCacheKey, clearAssignmentCache, createIdbPersister, trackPersistence } from "./idbPersister";

const client = (marker: string): PersistedClient => ({
  timestamp: 1, buster: "v1", clientState: { mutations: [], queries: [{ queryKey: [marker], queryHash: marker, state: {} } as never] },
});

describe("idbPersister", () => {
  it("round trips a client and removes it", async () => {
    const p = createIdbPersister("k1");
    await p.persistClient(client("a"));
    expect(await p.restoreClient()).toEqual(client("a"));
    await p.removeClient();
    expect(await p.restoreClient()).toBeUndefined();
  });

  it("keeps one entry per user", async () => {
    const a = createIdbPersister(assignmentCacheKey("user-a"));
    const b = createIdbPersister(assignmentCacheKey("user-b"));
    await a.persistClient(client("a"));
    expect(await b.restoreClient()).toBeUndefined();
    await b.persistClient(client("b"));
    expect(await a.restoreClient()).toEqual(client("a"));
    expect(await b.restoreClient()).toEqual(client("b"));
  });

  it("clearAssignmentCache stops every persisting and empties the whole store", async () => {
    const a = createIdbPersister(assignmentCacheKey("ua"));
    const b = createIdbPersister(assignmentCacheKey("ub"));
    await a.persistClient(client("a"));
    await b.persistClient(client("b"));
    const stopA = vi.fn();
    const stopB = vi.fn();
    trackPersistence("ua", stopA);
    trackPersistence("ub", stopB);
    await clearAssignmentCache("ua");
    expect(stopA).toHaveBeenCalledOnce();
    expect(stopB).toHaveBeenCalledOnce();
    expect(await a.restoreClient()).toBeUndefined();
    expect(await b.restoreClient()).toBeUndefined();
  });
});
