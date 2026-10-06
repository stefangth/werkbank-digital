import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anOrganization } from "@/test/fixtures";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { canAdd } = vi.hoisted(() => ({ canAdd: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canAdd.value }));

import { toast } from "sonner";
import { TechniciansPage } from "./TechniciansPage";

const rows = [
  { id: "a1", name: "Anna", email: "anna@x.de", phone: "111", user_id: "u1" },
  { id: "a2", name: "Bernd", email: "bernd@x.de", phone: null, user_id: null },
  { id: "a3", name: "Carla", email: null, phone: null, user_id: null },
];

interface SeedOptions {
  artists?: unknown[];
  artistsError?: unknown;
  inviteError?: unknown;
  insertError?: unknown;
  invitationsError?: unknown;
}

function seed({ artists = rows, artistsError = null, inviteError = null, insertError = null, invitationsError = null }: SeedOptions = {}) {
  const fake = createFakeSupabase({
    artists: { data: artistsError ? null : artists, error: artistsError },
    "rpc:list_pending_invited_artists": { data: ["a2"], error: null },
    // Pending invitations feed resend and revoke; accepted ones tell who actually joined.
    org_invitations: [
      invitationsError
        ? { when: { status: "pending" }, data: null, error: invitationsError }
        : { when: { status: "pending" }, data: [{ id: "inv-2", artist_id: "a2", email: "bernd@x.de" }], error: null },
      { when: { status: "accepted" }, data: [{ artist_id: "a1", email: "anna@x.de" }], error: null },
    ],
    "fn:create-invitation": inviteError ? { data: null, error: inviteError } : { data: { invitation: { id: "inv-9" } }, error: null },
    "fn:resend-invitation": { data: {}, error: null },
    "rpc:revoke_invitation": { data: null, error: null },
  });
  // The fake returns one seed per table; the insert's `.single()` needs its own row.
  const from = fake.from.bind(fake);
  Object.assign(client, fake, {
    from: (table: string) => {
      const chain = from(table);
      if (table === "artists") chain.single = () => Promise.resolve(insertError ? { data: null, error: insertError } : { data: { id: "new-1" }, error: null });
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
  beforeEach(() => {
    vi.clearAllMocks();
    canAdd.value = true;
  });

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
    seed({ artists: [] });
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

  async function fillAndSubmit() {
    fireEvent.click(await screen.findByRole("button", { name: "Add technician" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Dora" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "dora@x.de" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add and invite" }));
    return dialog;
  }

  it("closes the dialog after a failed invite, inserts the row only once and refreshes the list", async () => {
    const fake = seed({ inviteError: new Error("boom") });
    const { queryClient } = renderPage();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await fillAndSubmit();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Technician saved, but the invitation could not be sent. You can send it again from the list.",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.calls.filter((c) => c.method === "insert")).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["artists"] });
    // A fresh attempt starts from an empty form, so the saved row is never resubmitted.
    fireEvent.click(screen.getByRole("button", { name: "Add technician" }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByLabelText("Name")).toHaveValue("");
    expect(within(again).getByLabelText("Email")).toHaveValue("");
  });

  it("does not insert twice when the submit button is clicked repeatedly", async () => {
    const fake = seed();
    renderPage();
    const dialog = await fillAndSubmit();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add and invite" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add and invite" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(fake.calls.filter((c) => c.method === "insert")).toHaveLength(1);
    expect(fake.calls.filter((c) => c.table === "fn:create-invitation")).toHaveLength(1);
  });

  it("keeps the dialog open with a save error when the insert fails, and sends no invitation", async () => {
    const fake = seed({ insertError: new Error("rls") });
    renderPage();
    await fillAndSubmit();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The technician could not be saved. Please try again."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fake.calls.some((c) => c.table === "fn:create-invitation")).toBe(false);
  });

  it("hides the add actions for a user without the add_artists capability", async () => {
    canAdd.value = false;
    seed();
    renderPage();
    await screen.findByText("Anna");
    expect(screen.queryByRole("button", { name: "Add technician" })).not.toBeInTheDocument();
  });

  it("explains the empty state without an add action when the capability is missing", async () => {
    canAdd.value = false;
    seed({ artists: [] });
    renderPage();
    expect(await screen.findByText("No technicians yet")).toBeInTheDocument();
    expect(screen.getByText("Ask an admin to add technicians.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add your first technician" })).not.toBeInTheDocument();
  });

  it("shows the load error when the technicians cannot be loaded", async () => {
    seed({ artistsError: new Error("down") });
    renderPage();
    expect(await screen.findByText("Could not load your technicians. Please try again.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("tells the user when the pending invitations cannot be loaded and hides resend and revoke", async () => {
    seed({ invitationsError: new Error("down") });
    renderPage();
    expect(await screen.findByText(/Could not load the pending invitations/)).toBeInTheDocument();
    expect(screen.getByText("Bernd")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend invitation" })).not.toBeInTheDocument();
  });
});

describe("TechniciansPage invite action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAdd.value = true;
  });

  it("offers the invitation again for a linked login whose invitation expired unaccepted", async () => {
    seed({ artists: [{ id: "a4", name: "Dirk", email: "dirk@x.de", phone: null, user_id: "u4" }] });
    renderPage();
    await screen.findByText("Dirk");
    expect(screen.getByText("No account")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Send invitation" })).toBeInTheDocument();
  });

  it("shows Invited with resend and revoke for a linked login whose invitation is still pending", async () => {
    // create-invitation links user_id at invite time, so a fresh technician has both.
    seed({ artists: [{ id: "a2", name: "Bernd", email: "bernd@x.de", phone: null, user_id: "u2" }] });
    renderPage();
    await screen.findByText("Bernd");
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Resend invitation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke invitation" })).toBeInTheDocument();
  });

  it("invites a saved technician who has an email but no invitation", async () => {
    const fake = seed({ artists: [{ id: "a9", name: "Emil", email: "emil@x.de", phone: null, user_id: null }] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Invitation sent"));
    expect(fake.calls.find((c) => c.table === "fn:create-invitation")?.args[0]).toMatchObject({
      role: "artist", artist_id: "a9", email: "emil@x.de",
    });
  });
});
