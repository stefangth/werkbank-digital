import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anOrganization } from "@/test/fixtures";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { TechniciansPage } from "./TechniciansPage";

const rows = [
  { id: "a1", name: "Anna", email: "anna@x.de", phone: "111", user_id: "u1" },
  { id: "a2", name: "Bernd", email: "bernd@x.de", phone: null, user_id: null },
  { id: "a3", name: "Carla", email: null, phone: null, user_id: null },
];

function seed(artists: unknown[] = rows, inviteError: unknown = null) {
  const fake = createFakeSupabase({
    artists: { data: artists, error: null },
    "rpc:list_pending_invited_artists": { data: ["a2"], error: null },
    org_invitations: { data: [{ id: "inv-2", artist_id: "a2", email: "bernd@x.de" }], error: null },
    "fn:create-invitation": inviteError ? { data: null, error: inviteError } : { data: { invitation: { id: "inv-9" } }, error: null },
    "fn:resend-invitation": { data: {}, error: null },
    "rpc:revoke_invitation": { data: null, error: null },
  });
  // The fake returns one seed per table; the insert's `.single()` needs its own row.
  const from = fake.from.bind(fake);
  Object.assign(client, fake, {
    from: (table: string) => {
      const chain = from(table);
      if (table === "artists") chain.single = () => Promise.resolve({ data: { id: "new-1" }, error: null });
      return chain;
    },
  });
  return fake;
}

function renderPage() {
  return renderWithProviders(
    <TechniciansPage />,
    { authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never } },
  );
}

describe("TechniciansPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the three account pills", async () => {
    seed();
    renderPage();
    expect(await screen.findByText("Anna")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByText("No account")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Phone" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
  });

  it("shows the empty state with an add action", async () => {
    seed([]);
    renderPage();
    expect(await screen.findByText("No technicians yet")).toBeInTheDocument();
  });

  it("rejects an invalid email in the dialog and makes no call", async () => {
    const fake = seed();
    renderPage();
    await screen.findByText("Anna");
    fireEvent.click(screen.getByRole("button", { name: "Add technician" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Dora" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add and invite" }));
    expect(await within(dialog).findByText("Enter a valid email address")).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === "insert")).toBe(false);
    expect(fake.calls.some((c) => c.table === "fn:create-invitation")).toBe(false);
  });

  it("requires a name", async () => {
    const fake = seed();
    renderPage();
    await screen.findByText("Anna");
    fireEvent.click(screen.getByRole("button", { name: "Add technician" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "d@x.de" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add and invite" }));
    expect(await within(dialog).findByText("Enter a name")).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("creates and invites a technician, then closes the dialog with a toast", async () => {
    const fake = seed();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add technician" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Dora" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "dora@x.de" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add and invite" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Technician added and invitation sent"));
    expect(fake.calls.find((c) => c.method === "insert")?.args[0]).toMatchObject({ org_id: "org-1", name: "Dora", email: "dora@x.de", phone: null });
    expect(fake.calls.find((c) => c.table === "fn:create-invitation")?.args[0]).toMatchObject({ role: "artist", artist_id: "new-1" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("resends and revokes a pending invitation with translated toasts", async () => {
    const fake = seed();
    renderPage();
    await screen.findByText("Bernd");
    fireEvent.click(await screen.findByRole("button", { name: "Resend invitation" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Invitation sent again"));
    expect(fake.calls.find((c) => c.table === "fn:resend-invitation")?.args[0]).toMatchObject({ invitation_id: "inv-2" });
    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Invitation revoked"));
    expect(fake.calls.find((c) => c.table === "rpc:revoke_invitation")?.args[0]).toEqual({ p_id: "inv-2" });
  });

  it("keeps the dialog open and shows a translated error when the invitation fails", async () => {
    seed(rows, new Error("boom"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add technician" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Dora" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "dora@x.de" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add and invite" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not complete this. Check the list to see whether the technician was added."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
