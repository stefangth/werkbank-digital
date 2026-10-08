import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { QueryClient, dehydrate, useQuery } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import type { AuthContextType } from "@/features/auth/AuthContext";
import { APP_META } from "@/config/app.config";
import { assignmentCacheKey, createIdbPersister } from "../lib/idbPersister";

vi.mock("./registerServiceWorker", () => ({ registerServiceWorker: vi.fn() }));
import { registerServiceWorker } from "./registerServiceWorker";
vi.mock("./signOutCleanup", () => ({ watchSignOut: vi.fn() }));
import { watchSignOut } from "./signOutCleanup";
import { supabase } from "@/integrations/supabase/client";
import { AssignmentCacheProvider } from "./AssignmentCacheProvider";

const auth = (id: string) => ({ authOverrides: { user: { id }, currentOrg: { id: "org" } } as unknown as Partial<AuthContextType> });
const listKey = (user: string) => ["werkbank", "assignments", user, "org"];
const rows = [{ id: "o1", group_key: "today" }, { id: "o2", group_key: "done" }];

async function seed(user: string, buster: string = APP_META.VERSION) {
  const source = createTestQueryClient();
  source.setQueryData(listKey(user), rows);
  await createIdbPersister(assignmentCacheKey(user)).persistClient({ timestamp: Date.now(), buster, clientState: dehydrate(source) });
}

function Probe({ user }: { user: string }) {
  const { data } = useQuery<unknown[]>({ queryKey: listKey(user), queryFn: () => [], enabled: false });
  return <p>{data ? `rows ${data.length}` : "empty"}</p>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const u of ["a", "b", "c", "d", "e", "f"]) await createIdbPersister(assignmentCacheKey(u)).removeClient();
});

describe("AssignmentCacheProvider", () => {
  it("registers the service worker only here", () => {
    renderWithProviders(<AssignmentCacheProvider><p>x</p></AssignmentCacheProvider>, auth("a"));
    expect(registerServiceWorker).toHaveBeenCalledOnce();
  });

  it("watches every sign out with the app's query client", () => {
    const queryClient = createTestQueryClient();
    renderWithProviders(<AssignmentCacheProvider><p>x</p></AssignmentCacheProvider>, { queryClient, ...auth("a") });
    expect(watchSignOut).toHaveBeenCalledWith(supabase.auth, queryClient);
  });

  it("restores the signed-in user's cache and never another user's", async () => {
    await seed("a");
    const qcA = createTestQueryClient();
    const a = renderWithProviders(<AssignmentCacheProvider><Probe user="a" /></AssignmentCacheProvider>, { queryClient: qcA, ...auth("a") });
    await waitFor(() => expect(screen.getByText("rows 2")).toBeInTheDocument());
    a.unmount();
    const qcB = createTestQueryClient();
    renderWithProviders(<AssignmentCacheProvider><Probe user="a" /></AssignmentCacheProvider>, { queryClient: qcB, ...auth("b") });
    await new Promise((r) => setTimeout(r, 20));
    expect(qcB.getQueryData(listKey("a"))).toBeUndefined();
  });

  it("discards a cache written by another app version", async () => {
    await seed("c", "0.0.0");
    const queryClient = createTestQueryClient();
    renderWithProviders(<AssignmentCacheProvider><p>x</p></AssignmentCacheProvider>, { queryClient, ...auth("c") });
    await waitFor(async () => expect(await createIdbPersister(assignmentCacheKey("c")).restoreClient()).toBeUndefined());
    expect(queryClient.getQueryData(listKey("c"))).toBeUndefined();
  });

  it("never writes another user's queries into this user's entry (same tab, shared phone)", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    queryClient.setQueryData(listKey("e"), rows);
    queryClient.setQueryData([...listKey("e"), "o1"], { order: { id: "o1" } });
    renderWithProviders(<AssignmentCacheProvider><p>x</p></AssignmentCacheProvider>, { queryClient, ...auth("f") });
    await new Promise((r) => setTimeout(r, 20));
    queryClient.setQueryData(listKey("f"), rows);
    await waitFor(async () => {
      const stored = await createIdbPersister(assignmentCacheKey("f")).restoreClient();
      expect(stored?.clientState.queries.map((q) => q.queryKey)).toEqual([listKey("f")]);
    });
  });

  it("persists the list and offline details only, never signed URLs", async () => {
    // Nothing is garbage collected here, so only the filter can keep a query out.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    renderWithProviders(<AssignmentCacheProvider><p>x</p></AssignmentCacheProvider>, { queryClient, ...auth("d") });
    // Restoring an empty store is done once the persist subscription reacts to changes.
    await new Promise((r) => setTimeout(r, 20));
    queryClient.setQueryData(listKey("d"), rows);
    queryClient.setQueryData([...listKey("d"), "o1"], { order: { id: "o1" } });
    queryClient.setQueryData([...listKey("d"), "o2"], { order: { id: "o2" } });
    queryClient.setQueryData(["werkbank", "visit-object-urls", "org/o1/r/a.jpg"], { "org/o1/r/a.jpg": "https://signed" });
    queryClient.setQueryData(["werkbank", "orders", "org"], []);
    await waitFor(async () => {
      const stored = await createIdbPersister(assignmentCacheKey("d")).restoreClient();
      expect(stored?.clientState.queries.map((q) => q.queryKey)).toEqual([listKey("d"), [...listKey("d"), "o1"]]);
    });
  });
});
