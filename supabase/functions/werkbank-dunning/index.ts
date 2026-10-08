// werkbank-dunning: the dunning notice actions of the Werkbank module (Teil 5, spec R5).
//
// All actions: admin or producer of the org (requireOrgRole), handwerk orgs only.
//   preview      { org_id, invoice_id, payment_deadline? }                    -> application/pdf (watermark, persists nothing)
//   issue        { org_id, invoice_id, delivery, payment_deadline? }          -> { notice_id, stage }
//   download-url { org_id, notice_id }                                        -> { url }  (60 s)
// (`send` follows in the next task.)
//
// payment_deadline is optional: the default is Berlin today plus the profile's dunning_deadline_days.
//
// issue order is fixed: werkbank.create_dunning_notice through the CALLER's JWT client (the RPC
// checks the role and the blockers, draws the stage and snapshots the amounts), render the notice
// PDF, upload it to werkbank-documents at <org_id>/dunning/<notice_id>.pdf (upsert: false), then ONE
// service-role update of pdf_path and pdf_sha256 (lock_dunning_notice: service role only, once).
//   * Resume: a notice of this invoice without pdf_path skips the RPC and is rendered and stored.
//     If the upload finds the file already stored, the stored bytes are stamped. Nothing is removed.
//   * Every failure after the RPC committed answers 500 with issued: true (the UI offers the retry).
//
// verify_jwt = true in config.toml: there are no public actions here.
// DI: exports handle(req, deps, render); Deno.serve wiring at the bottom.

import { type Deps, realDeps } from "../_shared/deps.ts";
import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { resolveOrgKind } from "../_shared/orgKind.ts";
import { WERKBANK_ORG_KIND } from "../_shared/werkbank/registry.ts";
import { sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import { DOCUMENTS_BUCKET, isAlreadyExists, logoDataUrl } from "../_shared/werkbank/documentStorage.ts";
import type { CompanyProfileRow, InvoiceRow, SellerSnapshot } from "../_shared/werkbank/einvoice/invoiceData.ts";
import { buildDunningData, type DunningData, type DunningNoticeRow } from "../_shared/werkbank/pdf/dunningData.ts";
import { renderDunningPdf } from "../_shared/werkbank/pdf/dunningDocument.tsx";
import type { DunningBlocker } from "../_shared/werkbank/dunningDefaults.ts";

export interface DunningRenderers {
  pdf: (data: DunningData, logoDataUrl?: string) => Promise<Uint8Array>;
}

const SIGNED_URL_TTL = 60;
const BLOCKERS: readonly DunningBlocker[] = [
  "not_issued",
  "not_overdue",
  "nothing_open",
  "on_hold",
  "previous_stage_open",
  "max_stage",
];

type Body = Record<string, unknown>;
type Action = "preview" | "issue" | "download-url";

const isRecord = (v: unknown): v is Body => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Europe/Berlin, YYYY-MM-DD. */
const berlinToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function handle(
  req: Request,
  deps: Deps,
  render: DunningRenderers = { pdf: renderDunningPdf },
): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => null);
  if (!isRecord(body) || typeof body.action !== "string") return json({ error: "bad_request" }, 400);
  const action = body.action;
  if (action !== "preview" && action !== "issue" && action !== "download-url") {
    return json({ error: "unknown_action" }, 400);
  }

  const orgId = str(body.org_id);
  const invoiceId = str(body.invoice_id);
  const noticeId = str(body.notice_id);
  if (!orgId || (action === "download-url" ? !noticeId : !invoiceId)) return json({ error: "bad_request" }, 400);

  // Validated before any write; absent means the profile default.
  let deadline: string | null = null;
  if (body.payment_deadline !== undefined && body.payment_deadline !== null) {
    deadline = str(body.payment_deadline);
    if (!deadline || !DATE.test(deadline) || Number.isNaN(Date.parse(deadline))) return json({ error: "bad_request" }, 400);
  }
  let delivery: "email" | "print" = "email";
  if (action === "issue") {
    if (body.delivery !== "email" && body.delivery !== "print") return json({ error: "bad_request" }, 400);
    delivery = body.delivery;
  }

  const gate = await requireOrgRole(deps, req, orgId, ["admin", "producer"]);
  if (!gate.ok) {
    return gate.response.status === 403 ? json({ error: "forbidden" }, 403) : json({ error: "unauthorized" }, 401);
  }
  if ((await resolveOrgKind(deps.admin, orgId)) !== WERKBANK_ORG_KIND.kind) {
    return json({ error: "not_handwerk" }, 403);
  }

  switch (action as Action) {
    case "download-url":
      return downloadUrl(deps, orgId, noticeId!);
    case "preview":
    case "issue": {
      const invoice = await loadInvoice(deps, orgId, invoiceId!);
      if (invoice === "error") return json({ error: "load_failed" }, 500);
      if (!invoice) return json({ error: "not_found" }, 404);
      return action === "preview"
        ? previewNotice(deps, render, invoice, deadline)
        : issueNotice(req, deps, render, invoice, delivery, deadline);
    }
  }
}

async function loadInvoice(deps: Deps, orgId: string, id: string): Promise<InvoiceRow | null | "error"> {
  const { data, error } = await deps.admin.schema("werkbank").from("invoices")
    .select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (error) return "error";
  return (data ?? null) as unknown as InvoiceRow | null;
}

interface Context {
  profile: CompanyProfileRow & { dunning_deadline_days: number };
  notices: DunningNoticeRow[];
  balance: { claim: number | null; paid: number | null; open_amount: number | null; property_name: string | null } | null;
}

async function loadContext(deps: Deps, invoice: InvoiceRow): Promise<Context | "error" | "no_profile"> {
  const w = deps.admin.schema("werkbank");
  const [profile, notices, balance] = await Promise.all([
    w.from("company_profiles").select("*").eq("org_id", invoice.org_id).maybeSingle(),
    w.from("dunning_notices").select("*").eq("org_id", invoice.org_id).eq("invoice_id", invoice.id).order("stage"),
    w.from("invoice_balances").select("claim, paid, open_amount, property_name").eq("invoice_id", invoice.id).maybeSingle(),
  ]);
  if (profile.error || notices.error || balance.error) return "error";
  if (!profile.data) return "no_profile";
  return {
    profile: profile.data as unknown as Context["profile"],
    notices: (notices.data ?? []) as unknown as DunningNoticeRow[],
    balance: (balance.data ?? null) as unknown as Context["balance"],
  };
}

const contextError = (c: "error" | "no_profile") =>
  c === "no_profile" ? json({ error: "preflight_failed", blockers: ["profile_incomplete"] }, 422) : json({ error: "load_failed" }, 500);

// ── preview ──────────────────────────────────────────────────────────────────

async function previewNotice(deps: Deps, render: DunningRenderers, invoice: InvoiceRow, deadline: string | null): Promise<Response> {
  if (invoice.status === "draft") return json({ error: "not_allowed", blockers: ["not_issued"] }, 409);
  const ctx = await loadContext(deps, invoice);
  if (typeof ctx === "string") return contextError(ctx);

  const stage = Math.max(0, ...ctx.notices.map((n) => n.stage)) + 1;
  if (stage > 3) return json({ error: "not_allowed", blockers: ["max_stage"] }, 409);

  try {
    const today = berlinToday(deps.now());
    const data = buildDunningData({
      notice: {
        stage,
        notice_date: today,
        payment_deadline: deadline ?? addDays(today, ctx.profile.dunning_deadline_days),
        invoice_gross: Number(ctx.balance?.claim ?? 0),
        paid_amount: Number(ctx.balance?.paid ?? 0),
        open_amount: Number(ctx.balance?.open_amount ?? 0),
      },
      invoice,
      propertyName: ctx.balance?.property_name ?? null,
      profile: ctx.profile,
      earlier: ctx.notices,
      draft: true,
    });
    const seller = invoice.seller_snapshot as unknown as SellerSnapshot;
    const bytes = await render.pdf(data, await logoDataUrl(deps, seller.logo_path));
    return new Response(bytes as BodyInit, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/pdf" } });
  } catch (e) {
    console.error("werkbank-dunning: preview render failed", { invoiceId: invoice.id, error: String(e) });
    return json({ error: "render_failed" }, 500);
  }
}

// ── issue ────────────────────────────────────────────────────────────────────

/** The create_dunning_notice error as a response (migration 20261008140000). */
function createError(error: { code?: unknown; message?: unknown; details?: unknown }): Response {
  if (String(error.message ?? "") === "dunning_not_allowed") {
    const blockers = String(error.details ?? "").split(",").map((b) => b.trim())
      .filter((b): b is DunningBlocker => (BLOCKERS as readonly string[]).includes(b));
    return json({ error: "not_allowed", blockers }, 409);
  }
  if (error.code === "42501") return json({ error: "forbidden" }, 403);
  return json({ error: "issue_failed" }, 500);
}

/** After the RPC committed: the notice exists whatever happens next. */
const afterIssue = (error: string) => json({ error, issued: true }, 500);

async function issueNotice(
  req: Request,
  deps: Deps,
  render: DunningRenderers,
  invoice: InvoiceRow,
  delivery: "email" | "print",
  deadline: string | null,
): Promise<Response> {
  const ctx = await loadContext(deps, invoice);
  if (typeof ctx === "string") return contextError(ctx);

  // Resume: a notice without a file is stored as it is, the RPC is not called again.
  let notice = ctx.notices.find((n) => !n.pdf_path) ?? null;
  if (!notice) {
    const paymentDeadline = deadline ?? addDays(berlinToday(deps.now()), ctx.profile.dunning_deadline_days);
    // The caller's JWT (requireOrgRole already checked the header), never the service role:
    // create_dunning_notice checks the caller's org role itself.
    const user = deps.userClient(req.headers.get("Authorization") ?? "");
    const { data, error } = await user.schema("werkbank").rpc("create_dunning_notice", {
      p_invoice: invoice.id,
      p_delivery: delivery,
      p_payment_deadline: paymentDeadline,
    });
    if (error) return createError(error);
    if (!data) return afterIssue("issue_failed");
    notice = data as unknown as DunningNoticeRow;
  }

  let bytes: Uint8Array;
  try {
    const data = buildDunningData({
      notice,
      invoice,
      propertyName: ctx.balance?.property_name ?? null,
      profile: ctx.profile,
      earlier: ctx.notices.filter((n) => n.stage < notice!.stage),
      draft: false,
    });
    const seller = invoice.seller_snapshot as unknown as SellerSnapshot;
    bytes = await render.pdf(data, await logoDataUrl(deps, seller.logo_path));
  } catch (e) {
    console.error("werkbank-dunning: issue render failed", { noticeId: notice.id, error: String(e) });
    return afterIssue("render_failed");
  }

  const path = `${notice.org_id}/dunning/${notice.id}.pdf`;
  const documents = deps.admin.storage.from(DOCUMENTS_BUCKET);
  const { error: upErr } = await documents.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    if (!isAlreadyExists(upErr)) {
      console.error("werkbank-dunning: upload failed", { noticeId: notice.id, error: upErr });
      return afterIssue("render_failed");
    }
    // An earlier attempt stored the file but did not stamp it: that file is the original.
    const { data: file, error: dlErr } = await documents.download(path);
    if (dlErr || !file) {
      console.error("werkbank-dunning: reading the stored file failed", { noticeId: notice.id, error: dlErr });
      return afterIssue("render_failed");
    }
    bytes = new Uint8Array(await (file as Blob).arrayBuffer());
  }

  const { error: updErr } = await deps.admin.schema("werkbank").from("dunning_notices")
    .update({ pdf_path: path, pdf_sha256: await sha256Hex(bytes) })
    // Once: a concurrent resume that stamped first leaves zero rows here, which is fine (same file).
    .eq("id", notice.id).eq("org_id", notice.org_id).is("pdf_path", null);
  if (updErr) {
    console.error("werkbank-dunning: stamping the file failed", { noticeId: notice.id, error: updErr });
    return afterIssue("render_failed");
  }
  return json({ notice_id: notice.id, stage: notice.stage });
}

// ── download-url ─────────────────────────────────────────────────────────────

async function downloadUrl(deps: Deps, orgId: string, noticeId: string): Promise<Response> {
  const { data, error } = await deps.admin.schema("werkbank").from("dunning_notices")
    .select("pdf_path").eq("id", noticeId).eq("org_id", orgId).maybeSingle();
  if (error) return json({ error: "load_failed" }, 500);
  if (!data) return json({ error: "not_found" }, 404);
  const pdfPath = (data as unknown as { pdf_path: string | null }).pdf_path;
  if (!pdfPath) return json({ error: "pdf_missing" }, 409);
  const { data: signed, error: signErr } = await deps.admin.storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(pdfPath, SIGNED_URL_TTL);
  if (signErr || !signed?.signedUrl) return json({ error: "sign_failed" }, 500);
  return json({ url: signed.signedUrl });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
