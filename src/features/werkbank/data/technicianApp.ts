import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export const VISITS_BUCKET = "werkbank-visits";
const SIGNED_URL_SECONDS = 300;

/** One row of `my_assignments`. The generated type marks every column non-null; the database
 *  returns null for a missing date, time, subject or address part. */
export interface AssignmentRow {
  id: string;
  order_no: string;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  subject: string | null;
  customer_name: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  group_key: string;
}

export interface AssignmentPhoto { id: string; path: string; position: number; caption: string | null }

export interface AssignmentReport {
  id: string;
  artist_id: string | null;
  technician_name: string;
  visit_date: string;
  body: string;
  locked_at: string | null;
  signer_name: string | null;
  signature_path: string | null;
  signed_at: string | null;
  is_mine: boolean;
  photos: AssignmentPhoto[];
}

export interface AssignmentItem {
  position: number;
  title: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  kind: string;
}

/** The `my_assignment` jsonb: one assigned order without prices or the office note. */
export interface AssignmentDetail {
  order: {
    id: string;
    org_id: string;
    order_no: string;
    status: string;
    scheduled_date: string | null;
    scheduled_time: string | null;
    subject: string | null;
    customer_name: string | null;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    group_key: string | null;
    location_note: string | null;
    notes: string | null;
  };
  contact: { name: string | null; phone: string | null; mobile: string | null; email: string | null } | null;
  items: AssignmentItem[];
  technicians: string[];
  reports: AssignmentReport[];
}

/** Orgs of kind handwerk where the caller is a technician. */
export async function fetchTechnicianOrgs(client: Client): Promise<string[]> {
  const { data, error } = await client.schema("werkbank").rpc("my_technician_orgs");
  if (error) throw error;
  return (data ?? []) as string[];
}

export async function fetchAssignments(client: Client, orgId: string): Promise<AssignmentRow[]> {
  const { data, error } = await client.schema("werkbank").rpc("my_assignments", { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as unknown as AssignmentRow[];
}

export async function fetchAssignment(client: Client, orderId: string): Promise<AssignmentDetail> {
  const { data, error } = await client.schema("werkbank").rpc("my_assignment", { p_order: orderId });
  if (error) throw error;
  return data as unknown as AssignmentDetail;
}

export async function startAssignment(client: Client, orderId: string): Promise<void> {
  const { error } = await client.schema("werkbank").rpc("start_assignment", { p_order: orderId });
  if (error) throw error;
}

export async function completeAssignment(client: Client, orderId: string): Promise<void> {
  const { error } = await client.schema("werkbank").rpc("complete_assignment", { p_order: orderId });
  if (error) throw error;
}

/** Creates an unlocked report authored by the caller; returns its id. */
export async function createVisitReport(client: Client, orderId: string, visitDate?: string): Promise<string> {
  const { data, error } = await client.schema("werkbank").rpc("create_visit_report", { p_order: orderId, p_visit_date: visitDate });
  if (error) throw error;
  return data as string;
}

export async function updateVisitReport(client: Client, reportId: string, body: string, visitDate: string): Promise<void> {
  const { error } = await client.schema("werkbank").rpc("update_visit_report", { p_report: reportId, p_body: body, p_visit_date: visitDate });
  if (error) throw error;
}

/** Uploads under a fresh uuid, then registers the photo. A failure between the two leaves an
 *  unregistered object that nothing shows; a retry uploads a new path. */
export async function uploadVisitPhoto(
  client: Client,
  input: { orgId: string; orderId: string; reportId: string; file: Blob; caption?: string },
): Promise<string> {
  const path = `${input.orgId}/${input.orderId}/${input.reportId}/${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await client.storage.from(VISITS_BUCKET).upload(path, input.file, { contentType: "image/jpeg", upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await client.schema("werkbank").rpc("add_visit_photo", {
    p_report: input.reportId, p_path: path, p_caption: input.caption,
  });
  if (error) {
    // The object is not registered, so its author may still remove it; leaving it would use up
    // the report folder's upload room. Best effort: the registration error is what counts.
    await client.storage.from(VISITS_BUCKET).remove([path]).catch(() => undefined);
    throw error;
  }
  return data as string;
}

/** Deletes the row first (the database authorizes it and returns the path), then the object. A
 *  failed object delete is ignored: the photo is already gone from the report. */
export async function removeVisitPhoto(client: Client, photoId: string): Promise<void> {
  const { data, error } = await client.schema("werkbank").rpc("remove_visit_photo", { p_photo: photoId });
  if (error) throw error;
  if (typeof data === "string" && data) await client.storage.from(VISITS_BUCKET).remove([data]).catch(() => undefined);
}

export async function lockVisitReport(client: Client, reportId: string): Promise<void> {
  const { error } = await client.schema("werkbank").rpc("lock_visit_report", { p_report: reportId });
  if (error) throw error;
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { message, statusCode } = error as { message?: unknown; statusCode?: unknown };
  return String(statusCode) === "409" || (typeof message === "string" && /already exists/i.test(message));
}

/** Uploads signature.png, then signs. An "already exists" answer means an earlier attempt got the
 *  object there (a retry after a dropped connection, or a double tap), so the call goes on. */
export async function signVisitReport(
  client: Client,
  input: { orgId: string; orderId: string; reportId: string; signerName: string; png: Blob },
): Promise<void> {
  const path = `${input.orgId}/${input.orderId}/${input.reportId}/signature.png`;
  const bucket = client.storage.from(VISITS_BUCKET);
  const upload = () => bucket.upload(path, input.png, { contentType: "image/png", upsert: false });
  const { error: uploadError } = await upload();
  if (uploadError) {
    // "Already exists": an earlier attempt stored another image. Replace it with this drawing, or
    // the report would carry a signature the signer never made. Storage refuses the removal once
    // the report is signed or closed, which fails here as report_locked.
    if (!isAlreadyExists(uploadError)) throw uploadError;
    const { data: removed, error: removeError } = await bucket.remove([path]);
    if (removeError) throw removeError;
    if (!removed?.length) throw new Error("report_locked");
    const { error: retryError } = await upload();
    if (retryError) throw retryError;
  }
  const { error } = await client.schema("werkbank").rpc("sign_visit_report", {
    p_report: input.reportId, p_signer_name: input.signerName, p_signature_path: path,
  });
  if (error) throw error;
}

/** Signed URLs (300 s) for photo and signature paths, by path. */
export async function visitObjectUrls(client: Client, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await client.storage.from(VISITS_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error) throw error;
  const urls: Record<string, string> = {};
  for (const e of data ?? []) if (e.path && e.signedUrl) urls[e.path] = e.signedUrl;
  return urls;
}
