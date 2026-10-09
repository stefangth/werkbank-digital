import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { PERSIST_THROTTLE_MS, assignmentCacheKey, clearAssignmentCache, createIdbPersister, pruneAssignmentCache, trackPersistence } from "./idbPersister";

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
    await clearAssignmentCache();
    expect(stopA).toHaveBeenCalledOnce();
    expect(stopB).toHaveBeenCalledOnce();
    expect(await a.restoreClient()).toBeUndefined();
    expect(await b.restoreClient()).toBeUndefined();
  });

  it("pruneAssignmentCache keeps only the current user's fresh entry", async () => {
    const mine = createIdbPersister(assignmentCacheKey("me"));
    const other = createIdbPersister(assignmentCacheKey("someone-else"));
    await mine.persistClient({ ...client("mine"), timestamp: 1_000 });
    await other.persistClient({ ...client("other"), timestamp: 1_000 });
    await pruneAssignmentCache("me", 500, 1_200);
    expect(await mine.restoreClient()).toEqual({ ...client("mine"), timestamp: 1_000 });
    expect(await other.restoreClient()).toBeUndefined();
    await pruneAssignmentCache("me", 500, 2_000);
    expect(await mine.restoreClient()).toBeUndefined();
  });

  it("throttles writes: the first at once, the newest at the end of the window", async () => {
    const p = createIdbPersister(assignmentCacheKey("throttle"));
    await p.persistClient(client("first"));
    await p.persistClient(client("second"));
    await p.persistClient(client("third"));
    expect(await p.restoreClient()).toEqual(client("first"));
    await new Promise((r) => setTimeout(r, PERSIST_THROTTLE_MS + 50));
    expect(await p.restoreClient()).toEqual(client("third"));
  });

  it("clearAssignmentCache cancels a pending throttled write", async () => {
    const p = createIdbPersister(assignmentCacheKey("cancel"));
    await p.persistClient(client("first"));
    await p.persistClient(client("late"));
    await clearAssignmentCache();
    await new Promise((r) => setTimeout(r, PERSIST_THROTTLE_MS + 50));
    expect(await p.restoreClient()).toBeUndefined();
  });
});
