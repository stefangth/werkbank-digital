import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

import { StartList } from "./StartList";

function renderList(counts: { artists: number; items: number; customers: number }) {
  Object.assign(
    client,
    createFakeSupabase({
      artists: { data: null, error: null, count: counts.artists },
      "werkbank.catalog_items": { data: null, error: null, count: counts.items },
      "werkbank.customers": { data: null, error: null, count: counts.customers },
    }),
  );
  return renderWithProviders(
    <MemoryRouter>
      <StartList orgId="org-1" />
    </MemoryRouter>,
  );
}

describe("StartList", () => {
  it("shows the three steps in order with their links", async () => {
    renderList({ artists: 0, items: 0, customers: 0 });
    const links = await screen.findAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Add technicians", "/technicians"],
      ["Add or import services", "/catalog"],
      ["Add or import customers", "/customers"],
    ]);
    expect(screen.queryByTestId("step-done")).not.toBeInTheDocument();
  });

  it("marks a step with rows as done and shows its count", async () => {
    renderList({ artists: 3, items: 0, customers: 12 });
    const technicians = (await screen.findByRole("link", { name: /Add technicians/ })).closest("li")!;
    await waitFor(() => expect(within(technicians).getByText("3")).toBeInTheDocument());
    expect(within(technicians).getByTestId("step-done")).toBeInTheDocument();
    const customers = screen.getByRole("link", { name: /Add or import customers/ }).closest("li")!;
    expect(within(customers).getByText("12")).toBeInTheDocument();
    expect(within(customers).getByTestId("step-done")).toBeInTheDocument();
    const catalog = screen.getByRole("link", { name: /Add or import services/ }).closest("li")!;
    expect(within(catalog).queryByTestId("step-done")).not.toBeInTheDocument();
  });
});
