import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CompanyProfileRow } from "../schemas/companyProfile";

export type CompanyProfile = Database["werkbank"]["Tables"]["company_profiles"]["Row"];
type Client = SupabaseClient<Database>;

const BUCKET = "werkbank-assets";
const SIGNED_URL_SECONDS = 600;

/** The org's company profile, or null before it was filled in. The `.from(...)` and the
 *  `org_id` filter stay in one statement: src/test/orgScoping.test.ts scans for it. */
export async function fetchCompanyProfile(client: Client, orgId: string): Promise<CompanyProfile | null> {
  const { data, error } = await client.schema("werkbank").from("company_profiles").select("*").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveCompanyProfile(client: Client, orgId: string, row: CompanyProfileRow): Promise<void> {
  const { error } = await client.schema("werkbank").from("company_profiles")
    .upsert({ ...row, org_id: orgId }, { onConflict: "org_id" });
  if (error) throw error;
}

/** Stores the logo as `<orgId>/logo-<timestamp>.<ext>` (the storage policy needs the org id as
 *  the first path segment) and returns the path. */
export async function uploadLogo(client: Client, orgId: string, file: File): Promise<string> {
  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${orgId}/logo-${Date.now()}.${ext}`;
  const { error } = await client.storage.from(BUCKET).upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

/** A short-lived signed URL for the preview. */
export async function logoUrl(client: Client, path: string): Promise<string> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
