import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchPendingInvitedArtistIds } from "@/data/artists";
import { inviteArtistToApp } from "@/data/invitations";

export type TechnicianAccount = "active" | "invited" | "none";

export interface Technician {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  account: TechnicianAccount;
}

/** The org's technicians (artists rows) with their app-login state: a linked login is
 *  `active`, a live pending invite is `invited`, anything else has `none`. */
export async function fetchTechnicians(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<Technician[]> {
  const [{ data, error }, pendingIds] = await Promise.all([
    client.from("artists").select("id, name, email, phone, user_id").eq("org_id", orgId).order("name"),
    fetchPendingInvitedArtistIds(client, orgId),
  ]);
  if (error) throw error;
  const pending = new Set(pendingIds);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    account: row.user_id ? "active" : pending.has(row.id) ? "invited" : "none",
  }));
}

/** The technician row was saved but the app invitation could not be sent. Retrying the
 *  whole create would insert a duplicate row, so callers treat this as "saved" and offer
 *  the invitation again from the list. */
export class TechnicianInviteError extends Error {
  readonly artistId: string;
  readonly inviteCause: unknown;
  constructor(artistId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : "Invitation could not be sent");
    this.name = "TechnicianInviteError";
    this.artistId = artistId;
    this.inviteCause = cause;
  }
}

/** Add a technician and send the app invitation. The invite needs the new row's id, so the
 *  two steps run in order. If the insert fails the raw error is thrown and no invitation is
 *  sent; if only the invite fails a TechnicianInviteError carries the saved row's id. */
export async function createTechnician(
  client: SupabaseClient<Database>,
  args: { orgId: string; name: string; email: string; phone: string | null },
): Promise<{ id: string }> {
  const { data, error } = await client
    .from("artists")
    .insert({ name: args.name, email: args.email, phone: args.phone, org_id: args.orgId })
    .select("id")
    .single();
  if (error) throw error;
  try {
    await inviteArtistToApp(client, { orgId: args.orgId, artistId: data.id, email: args.email });
  } catch (e) {
    throw new TechnicianInviteError(data.id, e);
  }
  return { id: data.id };
}
