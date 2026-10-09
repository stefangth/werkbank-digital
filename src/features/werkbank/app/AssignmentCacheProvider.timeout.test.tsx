import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen } from "@testing-library/react";
import { useIsRestoring } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";

// A blocked IndexedDB: the restore never answers.
vi.mock("../lib/idbPersister", () => ({
  assignmentCacheKey: (id: string) => `assignments:${id}`,
  createIdbPersister: () => ({
    persistClient: async () => undefined,
    restoreClient: () => new Promise(() => undefined),
    removeClient: async () => undefined,
  }),
  pruneAssignmentCache: async () => undefined,
  trackPersistence: (_id: string, stop: () => void) => stop,
}));
vi.mock("./registerServiceWorker", () => ({ registerServiceWorker: vi.fn() }));
vi.mock("./signOutCleanup", () => ({ watchSignOut: vi.fn() }));
import { AssignmentCacheProvider, RESTORE_TIMEOUT_MS } from "./AssignmentCacheProvider";

const auth = { authOverrides: { user: { id: "a" }, currentOrg: { id: "org" } } as unknown as Partial<AuthContextType> };

function Probe() {
  return <p>{useIsRestoring() ? "restoring" : "ready"}</p>;
}

afterEach(() => { vi.useRealTimers(); });

describe("AssignmentCacheProvider with a blocked IndexedDB", () => {
  it("stops waiting for the offline copy after the restore timeout", () => {
    vi.useFakeTimers();
    renderWithProviders(<AssignmentCacheProvider><Probe /></AssignmentCacheProvider>, auth);
    expect(screen.getByText("restoring")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(RESTORE_TIMEOUT_MS); });
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
