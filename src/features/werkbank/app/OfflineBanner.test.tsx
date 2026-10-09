import { afterEach, describe, it, expect, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import type { AuthContextType } from "@/features/auth/AuthContext";
import { NeedsNetwork, OfflineBanner } from "./OfflineBanner";

const authOverrides = { user: { id: "u1" }, currentOrg: { id: "org" } } as unknown as Partial<AuthContextType>;

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  act(() => { window.dispatchEvent(new Event(online ? "online" : "offline")); });
}

afterEach(async () => {
  vi.restoreAllMocks();
  // The query client's online manager listens to the same events.
  act(() => { window.dispatchEvent(new Event("online")); });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("OfflineBanner", () => {
  it("shows the time of the last list fetch while offline and hides once online", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["werkbank", "assignments", "u1", "org"], [], { updatedAt: new Date(2026, 9, 9, 7, 42).getTime() });
    renderWithProviders(<OfflineBanner />, { queryClient, authOverrides });
    await act(async () => { await i18n.changeLanguage("de"); });
    expect(screen.queryByRole("status")).toBeNull();
    setOnline(false);
    expect(screen.getByRole("status")).toHaveTextContent("Offline. Stand: 07:42");
    setOnline(true);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says only offline without a fetched list", () => {
    renderWithProviders(<OfflineBanner />, { authOverrides });
    setOnline(false);
    expect(screen.getByRole("status")).toHaveTextContent(/^Offline\.$/);
  });

  it("counts a failed network fetch of the list as offline", async () => {
    const queryClient = createTestQueryClient();
    renderWithProviders(<OfflineBanner />, { queryClient, authOverrides });
    await act(async () => {
      await queryClient.fetchQuery({
        queryKey: ["werkbank", "assignments", "u1", "org"], networkMode: "always", gcTime: Infinity,
        queryFn: () => Promise.reject({ message: "TypeError: Failed to fetch" }),
      }).catch(() => undefined);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Offline.");
  });
});

describe("NeedsNetwork", () => {
  it("renders the hint only offline", () => {
    renderWithProviders(<NeedsNetwork />, { authOverrides });
    expect(screen.queryByText("Needs a connection")).toBeNull();
    setOnline(false);
    expect(screen.getByText("Needs a connection")).toBeInTheDocument();
  });
});
