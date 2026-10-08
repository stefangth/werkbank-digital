import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

import { StartList } from "./StartList";

const COMPLETE = {
  company_name: "Muster GmbH", street: "Hauptstr. 1", postal_code: "01067", city: "Dresden",
  email: "info@muster.example", tax_number: "201/123/45678", vat_id: null,
};

function renderList(counts: { artists: number; items: number; customers: number; invoices?: number; payments?: number }, company: unknown = null, isAdmin = true) {
  Object.assign(
    client,
    createFakeSupabase({
      artists: { data: null, error: null, count: counts.artists },
      "werkbank.catalog_items": { data: null, error: null, count: counts.items },
      "werkbank.customers": { data: null, error: null, count: counts.customers },
      "werkbank.company_profiles": { data: company, error: null },
      "werkbank.invoices": { data: null, error: null, count: counts.invoices ?? 0 },
      "werkbank.invoice_entries": { data: null, error: null, count: counts.payments ?? 0 },
    }),
  );
  return renderWithProviders(
    <MemoryRouter>
      <StartList orgId="org-1" />
    </MemoryRouter>,
    { authOverrides: { hasRole: ((r: string) => (r === "admin" ? isAdmin : r === "producer")) as never } },
  );
}

describe("StartList", () => {
  it("shows the six steps in order with their links", async () => {
    renderList({ artists: 0, items: 0, customers: 0 });
    const links = await screen.findAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Fill in company details", "/settings?tab=company"],
      ["Add technicians", "/technicians"],
      ["Add or import services", "/catalog"],
      ["Add or import customers", "/customers"],
      ["Issue your first invoice", "/invoices"],
      ["Record your first payment", "/open-items"],
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

  it("marks the company step done once the profile is complete", async () => {
    renderList({ artists: 0, items: 0, customers: 0 }, COMPLETE);
    const company = (await screen.findByRole("link", { name: /Fill in company details/ })).closest("li")!;
    await waitFor(() => expect(within(company).getByTestId("step-done")).toBeInTheDocument());
  });

  it("keeps the company step open while the profile is incomplete or missing", async () => {
    renderList({ artists: 2, items: 0, customers: 0 }, { ...COMPLETE, email: "" });
    const company = (await screen.findByRole("link", { name: /Fill in company details/ })).closest("li")!;
    await waitFor(() => expect(screen.getByTestId("step-done")).toBeInTheDocument());
    expect(within(company).queryByTestId("step-done")).not.toBeInTheDocument();
  });

  it("hides the company step from a producer", async () => {
    renderList({ artists: 0, items: 0, customers: 0 }, null, false);
    const links = await screen.findAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Add technicians",
      "Add or import services",
      "Add or import customers",
      "Issue your first invoice",
      "Record your first payment",
    ]);
  });

  it("marks the invoice step done once an invoice is issued", async () => {
    renderList({ artists: 0, items: 0, customers: 0, invoices: 2 });
    const step = (await screen.findByRole("link", { name: /Issue your first invoice/ })).closest("li")!;
    await waitFor(() => expect(within(step).getByTestId("step-done")).toBeInTheDocument());
  });

  it("marks the payment step done once a payment exists, and asks only for payment entries", async () => {
    renderList({ artists: 0, items: 0, customers: 0, payments: 1 });
    const step = (await screen.findByRole("link", { name: /Record your first payment/ })).closest("li")!;
    await waitFor(() => expect(within(step).getByTestId("step-done")).toBeInTheDocument());
    const calls = (client as unknown as ReturnType<typeof createFakeSupabase>).calls.filter((c) => c.table === "werkbank.invoice_entries");
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "kind" && c.args[1] === "payment")).toBe(true);
  });

  it("keeps the payment step open while there is no payment", async () => {
    renderList({ artists: 0, items: 0, customers: 0, invoices: 1 });
    const step = (await screen.findByRole("link", { name: /Record your first payment/ })).closest("li")!;
    await waitFor(() => expect(screen.getByTestId("step-done")).toBeInTheDocument());
    expect(within(step).queryByTestId("step-done")).not.toBeInTheDocument();
  });
});
