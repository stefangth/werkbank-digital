import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { edgeResponseContext } from "@/lib/edgeErrors";

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

/** The visit report PDF of an order (werkbank-reports): every report, or only `reportIds`. Nothing
 *  is stored; resolves to the PDF bytes. */
export async function downloadVisitReportPdf(
  client: Client,
  a: { orgId: string; orderId: string; reportIds?: string[] },
): Promise<Blob> {
  const { data, error } = await client.functions.invoke("werkbank-reports", {
    body: { org_id: a.orgId, order_id: a.orderId, ...(a.reportIds ? { report_ids: a.reportIds } : {}) },
  });
  if (error) throw await readPdfError(error);
  return data as Blob;
}

/** A failed werkbank-reports call: the function's `{ error: code }` ("unknown" without a body). */
export class VisitReportPdfError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "VisitReportPdfError";
  }
}

async function readPdfError(error: unknown): Promise<VisitReportPdfError> {
  const res = edgeResponseContext(error);
  if (!res) return new VisitReportPdfError("unknown");
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    return new VisitReportPdfError(typeof body.error === "string" ? body.error : "unknown");
  } catch {
    return new VisitReportPdfError("unknown");
  }
}

/** The `werkbank` i18n key for a failed visit report PDF. */
export function visitReportPdfErrorKey(error: unknown): string {
  const code = error instanceof VisitReportPdfError ? error.code : "unknown";
  if (code === "preflight_failed") return "orders.reports.pdfProfileIncomplete";
  if (code === "no_reports") return "orders.reports.pdfNoReports";
  return "invoices.page.pdfFailed";
}
