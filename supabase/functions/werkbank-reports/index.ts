// werkbank-reports: the visit report PDF of an order (Werkbank Teil 6a, spec R7).
//
//   POST { org_id, order_id, report_ids?: uuid[] } -> application/pdf
//
// Admin or producer of the org (requireOrgRole), handwerk orgs only. Without report_ids the PDF
// holds every report of the order, locked or not, newest last; an unlocked report carries an
// "Entwurf" marker. Letterhead from the live company profile, line items with quantity and unit
// only (never a price), photos and signatures downloaded from werkbank-visits with the service
// role. Stores nothing: locked reports are immutable, so the PDF is reproducible.
//
// Errors: 400 bad_request, 401 unauthorized, 403 forbidden, 404 not_found (no handwerk org or no
// such order in the org), 404 no_reports, 422 preflight_failed (no company profile), 500 load_failed
// (a read failed), 500 render_failed (the PDF could not be built).
//
// verify_jwt = true in config.toml: there are no public actions here.
// DI: exports handle(req, deps, render); Deno.serve wiring at the bottom.

import { type Deps, realDeps } from "../_shared/deps.ts";
import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { resolveOrgKind } from "../_shared/orgKind.ts";
import { WERKBANK_ORG_KIND } from "../_shared/werkbank/registry.ts";
import { loadVisitReportData, type VisitReportPdfData } from "../_shared/werkbank/pdf/visitReportData.ts";
import { renderVisitReportPdf } from "../_shared/werkbank/pdf/visitReportDocument.tsx";

export interface VisitReportRenderers {
  renderVisitReportPdf: (data: VisitReportPdfData) => Promise<Uint8Array>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A trimmed uuid string, else null: anything else would fail in Postgres as a 500. */
const str = (v: unknown): string | null => (typeof v === "string" && UUID.test(v.trim()) ? v.trim() : null);

/** More report ids than any order has; keeps the reports query small. */
const MAX_REPORT_IDS = 200;

/** undefined when absent, null when malformed (not a non-empty array of at most 200 uuids). */
function parseReportIds(v: unknown): string[] | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_REPORT_IDS) return null;
  const ids = v.map(str);
  return ids.every((id): id is string => id !== null) ? [...new Set(ids)] : null;
}

export async function handle(
  req: Request,
  deps: Deps,
  render: VisitReportRenderers = { renderVisitReportPdf },
): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => null);
  if (!isRecord(body)) return json({ error: "bad_request" }, 400);
  const orgId = str(body.org_id);
  const orderId = str(body.order_id);
  const reportIds = parseReportIds(body.report_ids);
  if (!orgId || !orderId || reportIds === null) return json({ error: "bad_request" }, 400);

  const gate = await requireOrgRole(deps, req, orgId, ["admin", "producer"]);
  if (!gate.ok) {
    return gate.response.status === 403 ? json({ error: "forbidden" }, 403) : json({ error: "unauthorized" }, 401);
  }
  if ((await resolveOrgKind(deps.admin, orgId)) !== WERKBANK_ORG_KIND.kind) {
    return json({ error: "not_found" }, 404);
  }

  let data: VisitReportPdfData | null;
  try {
    data = await loadVisitReportData(deps.admin, orgId, orderId, reportIds);
  } catch (e) {
    if (e instanceof Error && e.message === "profile_missing") {
      return json({ error: "preflight_failed", blockers: ["profile_incomplete"] }, 422);
    }
    console.error("werkbank-reports: load failed", { orderId, error: String(e) });
    return json({ error: "load_failed" }, 500);
  }
  if (!data) return json({ error: "not_found" }, 404);
  if (data.reports.length === 0) return json({ error: "no_reports" }, 404);

  try {
    const bytes = await render.renderVisitReportPdf(data);
    return new Response(bytes as BodyInit, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("werkbank-reports: render failed", { orderId, error: String(e) });
    return json({ error: "render_failed" }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
