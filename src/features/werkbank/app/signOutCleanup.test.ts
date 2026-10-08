import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dehydrate } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test/queryClient";
import { assignmentCacheKey, createIdbPersister } from "../lib/idbPersister";
import { watchSignOut } from "./signOutCleanup";
import { uploadedSignatures } from "./signatureStore";

type Listener = (event: string) => void;

function fakeAuth() {
  const listeners: Listener[] = [];
  const onAuthStateChange = vi.fn((cb: Listener) => {
    listeners.push(cb);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  return { auth: { onAuthStateChange }, emit: (e: string) => listeners.forEach((l) => l(e)), onAuthStateChange };
}

async function seedCache(user: string) {
  const source = createTestQueryClient();
  source.setQueryData(["werkbank", "assignments", user, "org"], [{ id: "o1" }]);
  await createIdbPersister(assignmentCacheKey(user)).persistClient({ timestamp: Date.now(), buster: "x", clientState: dehydrate(source) });
}

beforeEach(async () => {
  await createIdbPersister(assignmentCacheKey("a")).removeClient();
  uploadedSignatures.clear();
});

describe("watchSignOut", () => {
  it("subscribes once, however often the provider mounts", async () => {
    const { auth, onAuthStateChange } = fakeAuth();
    watchSignOut(auth, createTestQueryClient());
    watchSignOut(auth, createTestQueryClient());
    expect(onAuthStateChange).toHaveBeenCalledOnce();
  });

  it("on any sign out drops the offline copy, the werkbank queries and stored signatures", async () => {
    const { auth, emit } = fakeAuth();
    const first = createTestQueryClient();
    const qc = createTestQueryClient();
    watchSignOut(auth, first);
    // The latest provider's client is the one cleared.
    watchSignOut(auth, qc);
    await seedCache("a");
    qc.setQueryData(["werkbank", "assignments", "a", "org"], [{ id: "o1" }]);
    qc.setQueryData(["profiles", "me"], { id: "a" });
    uploadedSignatures.set("r1", { png: new Blob(["s"]), signerName: "Frau Meier" });

    emit("TOKEN_REFRESHED");
    expect(qc.getQueryData(["werkbank", "assignments", "a", "org"])).toBeDefined();
    expect(uploadedSignatures.size).toBe(1);

    emit("SIGNED_OUT");
    expect(qc.getQueryData(["werkbank", "assignments", "a", "org"])).toBeUndefined();
    expect(qc.getQueryData(["profiles", "me"])).toEqual({ id: "a" });
    expect(uploadedSignatures.size).toBe(0);
    await vi.waitFor(async () => expect(await createIdbPersister(assignmentCacheKey("a")).restoreClient()).toBeUndefined());
  });
});
