// Loads what the visit report PDF (Teil 6a, R7) prints: the seller from the live company profile,
// the order header, the order's line items without any price, and the visit reports with their
// photos and signature as data URLs. Runs with the service role, so every read is scoped to the
// org explicitly. No prices leave this module (spec non-goal).
import type { Deps } from "../../deps.ts";
import { draftSellerSnapshot, type SellerSnapshot } from "../einvoice/invoiceData.ts";
import { imageDataUrl, logoDataUrl, VISITS_BUCKET } from "../documentStorage.ts";
import { type CustomerRow, customerName, type ItemRow, locationLines, type ProfileRow, type PropertyRow } from "./quoteData.ts";
import { buildSections, type QuotePdfRow } from "./sections.ts";
import type { Database } from "../../database.types.ts";

type W = Database["werkbank"]["Tables"];
type OrderRow = W["orders"]["Row"];
type ReportRow = W["visit_reports"]["Row"];
type PhotoRow = W["visit_report_photos"]["Row"];

/** An item or text row of the order with quantity and unit only. */
export type VisitReportItemRow = Omit<QuotePdfRow, "unitPrice" | "lineNet">;

export interface VisitReportSection {
  title?: string;
  number?: string;
  rows: VisitReportItemRow[];
}

export interface VisitReportPdfReport {
  id: string;
  visitDate: string;
  technician: string;
  body: string;
  /** Not locked yet: the technician may still change it. */
  draft: boolean;
  /** Photo data URLs in position order; an unreadable photo is left out. */
  photos: string[];
  signature: { name: string; signedAt: string; imageDataUrl?: string } | null;
}

export interface VisitReportPdfData {
  seller: SellerSnapshot;
  logoDataUrl?: string;
  orderNumber: string;
  subject?: string;
  customer: string;
  location: string[];
  sections: VisitReportSection[];
  reports: VisitReportPdfReport[];
}

type Admin = Deps["admin"];

/** The order's sections with every price and subtotal dropped. */
export function priceFreeSections(items: ItemRow[]): VisitReportSection[] {
  return buildSections(items).map((sec) => ({
    ...(sec.title !== undefined ? { title: sec.title, number: sec.number } : {}),
    rows: sec.rows.map(({ unitPrice: _p, lineNet: _n, ...row }) => row),
  }));
}

/** null when the order does not exist in this org. Throws `profile_missing` without a company
 *  profile and `load_failed` on a read error. Reports are ordered by visit date, newest last. */
export async function loadVisitReportData(
  admin: Admin,
  orgId: string,
  orderId: string,
  reportIds?: string[],
): Promise<VisitReportPdfData | null> {
  const w = admin.schema("werkbank");
  const orderRes = await w.from("orders").select("*").eq("org_id", orgId).eq("id", orderId).maybeSingle();
  if (orderRes.error) throw new Error("load_failed");
  const order = orderRes.data as unknown as OrderRow | null;
  if (!order) return null;

  let reportQuery = w.from("visit_reports").select("*").eq("org_id", orgId).eq("order_id", orderId);
  if (reportIds) reportQuery = reportQuery.in("id", reportIds);
  const [profileRes, customerRes, propertyRes, itemsRes, reportsRes] = await Promise.all([
    w.from("company_profiles").select("*").eq("org_id", orgId).maybeSingle(),
    w.from("customers").select("*").eq("org_id", orgId).eq("id", order.customer_id).maybeSingle(),
    order.property_id
      ? w.from("properties").select("*").eq("org_id", orgId).eq("id", order.property_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    w.from("document_items").select("*").eq("org_id", orgId).eq("order_id", orderId),
    reportQuery.order("visit_date", { ascending: true }).order("created_at", { ascending: true }).order("id"),
  ]);
  if (profileRes.error || customerRes.error || propertyRes.error || itemsRes.error || reportsRes.error) throw new Error("load_failed");
  const profile = profileRes.data as unknown as ProfileRow | null;
  if (!profile) throw new Error("profile_missing");
  const customer = customerRes.data as unknown as CustomerRow | null;
  const property = propertyRes.data as unknown as PropertyRow | null;
  const reports = (reportsRes.data ?? []) as unknown as ReportRow[];

  let photos: PhotoRow[] = [];
  if (reports.length > 0) {
    const photosRes = await w.from("visit_report_photos").select("*").eq("org_id", orgId)
      .in("report_id", reports.map((r) => r.id)).order("position");
    if (photosRes.error) throw new Error("load_failed");
    photos = (photosRes.data ?? []) as unknown as PhotoRow[];
  }

  const deps = { admin };
  const image = (path: string | null) => imageDataUrl(deps, VISITS_BUCKET, path);
  // One download at a time: a report may hold 20 photos of up to 5 MB each.
  const pdfReports: VisitReportPdfReport[] = [];
  for (const r of reports) {
    const own = photos.filter((p) => p.report_id === r.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const urls: string[] = [];
    for (const p of own) {
      const url = await image(p.path);
      if (url) urls.push(url);
    }
    pdfReports.push({
      id: r.id,
      visitDate: r.visit_date,
      technician: r.technician_name,
      body: r.body,
      draft: r.locked_at === null,
      photos: urls,
      signature: r.signed_at && r.signer_name
        ? { name: r.signer_name, signedAt: r.signed_at, imageDataUrl: await image(r.signature_path) }
        : null,
    });
  }

  return {
    seller: draftSellerSnapshot(profile),
    logoDataUrl: await logoDataUrl(deps, profile.logo_path),
    orderNumber: order.order_no,
    subject: order.subject?.trim() || undefined,
    customer: customer ? customerName(customer) : "",
    location: customer ? locationLines(customer, property) : [],
    sections: priceFreeSections((itemsRes.data ?? []) as unknown as ItemRow[]),
    reports: pdfReports,
  };
}
