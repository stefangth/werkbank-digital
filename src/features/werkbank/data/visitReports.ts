import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;
type ReportRow = Database["werkbank"]["Tables"]["visit_reports"]["Row"];
type PhotoRow = Database["werkbank"]["Tables"]["visit_report_photos"]["Row"];

export type VisitReport = ReportRow & { photos: PhotoRow[] };

/** The visit reports of an order for the office, oldest visit first, with their photos in order. */
export async function fetchVisitReports(client: Client, orgId: string, orderId: string): Promise<VisitReport[]> {
  const { data, error } = await client.schema("werkbank").from("visit_reports")
    .select("*, photos:visit_report_photos(*)")
    .eq("org_id", orgId).eq("order_id", orderId)
    .order("visit_date", { ascending: true }).order("created_at", { ascending: true }).order("id");
  if (error) throw error;
  const rows = (data ?? []) as unknown as VisitReport[];
  return rows.map((r) => ({ ...r, photos: [...(r.photos ?? [])].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)) }));
}

/** The office note is the one column the office may write on a report, locked or not. */
export async function updateOfficeNote(client: Client, reportId: string, note: string | null): Promise<void> {
  const { error } = await client.schema("werkbank").from("visit_reports").update({ office_note: note }).eq("id", reportId);
  if (error) throw error;
}
