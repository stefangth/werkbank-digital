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

/** Accepted technician invitations of the org: who actually joined. create-invitation
 *  links artists.user_id (and the membership) at invite time, so a linked login alone does
 *  not prove the technician ever accepted. Matches like list_pending_invited_artists: by
 *  artist id, or by email for an invitation without one. Readable by admins and, for
 *  artist invitations, by producers (RLS on org_invitations). */
async function fetchJoined(client: SupabaseClient<Database>, orgId: string) {
  const { data, error } = await client
    .from("org_invitations")
    .select("artist_id, email")
    .eq("org_id", orgId)
    .eq("status", "accepted")
    .eq("role", "artist");
  if (error) throw error;
  const rows = data ?? [];
  const artistIds = new Set(rows.flatMap((r) => (r.artist_id ? [r.artist_id] : [])));
  const emails = new Set(rows.flatMap((r) => (r.artist_id ? [] : [r.email.toLowerCase()])));
  return (id: string, email: string | null) =>
    artistIds.has(id) || (email !== null && emails.has(email.toLowerCase()));
}

/** The org's technicians (artists rows) with their app-login state: a live pending invite is
 *  `invited` (it wins, because create-invitation links the login at invite time, before the
 *  technician has accepted), a linked login with an accepted invitation is `active`, anything
 *  else (including a linked login whose invitation expired unaccepted) has `none`, so the
 *  page offers the invitation again. */
export async function fetchTechnicians(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<Technician[]> {
  const [{ data, error }, pendingIds, joined] = await Promise.all([
    client.from("artists").select("id, name, email, phone, user_id").eq("org_id", orgId).order("name"),
    fetchPendingInvitedArtistIds(client, orgId),
    fetchJoined(client, orgId),
  ]);
  if (error) throw error;
  const pending = new Set(pendingIds);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    account: pending.has(row.id) ? "invited" : row.user_id && joined(row.id, row.email) ? "active" : "none",
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
