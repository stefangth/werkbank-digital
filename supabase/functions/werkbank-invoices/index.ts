// werkbank-invoices: the invoice document actions of the Werkbank module (spec R5).
//
// All actions: admin or producer of the org (requireOrgRole), handwerk orgs only.
//   preview      { org_id, invoice_id }        -> { pdf_base64 }          (drafts only; watermark, no XML, persists nothing)
//   issue        { org_id, invoice_id, send? } -> { ok: true, invoice_no, email_sent? }
//   send         { org_id, invoice_id, to[], cc[], message } -> { ok: true, email_sent: true }
//   download-url { org_id, invoice_id }        -> { url }                 (60 s)
//
// issue order is fixed: werkbank.finalize_invoice through the CALLER's JWT client (so the RPC's
// own role check applies; it draws the number and writes the snapshots in one transaction), then
// render the Factur-X file from the returned row, upload it to werkbank-documents at
// <org_id>/invoices/<invoice_id>.pdf (upsert: false), then ONE service-role update of pdf_path and
// pdf_sha256 (only the service role may write them, once: lock_invoice trigger).
//   * Resume: an invoice already issued (or cancelled) without pdf_path skips the RPC and renders.
//     If the upload finds the file already stored, the stored bytes are stamped. Nothing is ever
//     removed: a storage trigger forbids update and delete under <org>/invoices/.
//   * An invoice with pdf_path is done: 409 invalid_state.
//   * Every failure after the RPC committed answers 500 with issued: true (the number is drawn,
//     the UI refetches and offers the retry, which resumes).
//   * `send` (R7) emails the STORED file (downloaded, never rendered again) as the one attachment of an
//     invoice-sent message per recipient (to and cc), reply_to = the seller's email, then stamps sent_at
//     and sent_to. issue with send runs it after the file is stored; a failed email then answers
//     502 { error: "send_failed", issued: true } (the invoice stays issued; the UI offers send).
//
// verify_jwt = true in config.toml: there are no public actions here.
//
// DI: exports handle(req, deps, render); Deno.serve wiring at the bottom.

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { type Deps, emailWasSent, realDeps } from "../_shared/deps.ts";
import { json, preflight } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { resolveOrgKind } from "../_shared/orgKind.ts";
import { WERKBANK_ORG_KIND } from "../_shared/werkbank/registry.ts";
import { sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import { DOCUMENTS_BUCKET, isAlreadyExists, logoDataUrl } from "../_shared/werkbank/documentStorage.ts";
import {
  buildInvoiceData,
  type BuyerSnapshot,
  type CompanyProfileRow,
  type CustomerRow,
  draftBuyerSnapshot,
  draftSellerSnapshot,
  type InvoiceData,
  type InvoiceItemRow,
  type InvoiceRow,
  type InvoiceTotalsRow,
  type PropertyRow,
  type SellerSnapshot,
} from "../_shared/werkbank/einvoice/invoiceData.ts";
import { renderInvoicePdf } from "../_shared/werkbank/einvoice/invoiceDocument.tsx";
import { renderEInvoice } from "../_shared/werkbank/einvoice/renderEInvoice.ts";
import { type InvoiceBlocker, invoicePreflight } from "../_shared/werkbank/invoicePreflight.ts";
import { checkRecipients, MAX_MESSAGE_CHARS } from "../_shared/werkbank/recipients.ts";
import { formatDateDe } from "../_shared/werkbank/pdf/quoteData.ts";

export interface InvoiceRenderers {
  /** The visual PDF only (preview). */
  pdf: (data: InvoiceData, logoDataUrl?: string) => Promise<Uint8Array>;
  /** The Factur-X file: PDF/A-3 with factur-x.xml embedded (issue). */
  einvoice: (data: InvoiceData, logoDataUrl?: string) => Promise<Uint8Array>;
}

const SIGNED_URL_TTL = 60;

type Body = Record<string, unknown>;
type Action = "preview" | "issue" | "send" | "download-url";

const isRecord = (v: unknown): v is Body => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export async function handle(
  req: Request,
  deps: Deps,
  render: InvoiceRenderers = { pdf: renderInvoicePdf, einvoice: renderEInvoice },
): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => null);
  if (!isRecord(body) || typeof body.action !== "string") return json({ error: "bad_request" }, 400);
  const action = body.action;
  if (action !== "preview" && action !== "issue" && action !== "send" && action !== "download-url") {
    return json({ error: "unknown_action" }, 400);
  }

  const orgId = str(body.org_id);
  const invoiceId = str(body.invoice_id);
  if (!orgId || !invoiceId) return json({ error: "bad_request" }, 400);

  const gate = await requireOrgRole(deps, req, orgId, ["admin", "producer"]);
  if (!gate.ok) {
    return gate.response.status === 403 ? json({ error: "forbidden" }, 403) : json({ error: "unauthorized" }, 401);
  }
  if ((await resolveOrgKind(deps.admin, orgId)) !== WERKBANK_ORG_KIND.kind) {
    return json({ error: "not_handwerk" }, 403);
  }

  const invoice = await loadInvoice(deps, orgId, invoiceId);
  if (invoice === "error") return json({ error: "load_failed" }, 500);
  if (!invoice) return json({ error: "not_found" }, 404);

  switch (action as Action) {
    case "preview":
      return previewInvoice(deps, render, invoice);
    case "issue":
      return issueInvoice(req, deps, render, invoice, body);
    case "send": {
      const input = parseSend(body);
      if (input instanceof Response) return input;
      return sendInvoice(deps, invoice, input);
    }
    case "download-url":
      return downloadUrl(deps, invoice);
  }
}

async function loadInvoice(deps: Deps, orgId: string, id: string): Promise<InvoiceRow | null | "error"> {
  const { data, error } = await deps.admin.schema("werkbank").from("invoices")
    .select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (error) return "error";
  return (data ?? null) as unknown as InvoiceRow | null;
}

interface LoadedLines {
  items: InvoiceItemRow[];
  totals: InvoiceTotalsRow;
  /** The cancelled original, for a cancellation. */
  original: InvoiceRow | null;
}

async function loadLines(deps: Deps, invoice: InvoiceRow): Promise<LoadedLines | null> {
  const w = deps.admin.schema("werkbank");
  const [items, totals] = await Promise.all([
    w.from("document_items").select("*").eq("org_id", invoice.org_id).eq("invoice_id", invoice.id).order("sort_order"),
    w.from("document_totals").select("*").eq("invoice_id", invoice.id).maybeSingle(),
  ]);
  if (items.error || totals.error || !totals.data) return null;
  let original: InvoiceRow | null = null;
  if (invoice.cancels_invoice_id) {
    const o = await loadInvoice(deps, invoice.org_id, invoice.cancels_invoice_id);
    if (o === "error" || !o) return null;
    original = o;
  }
  return {
    items: (items.data ?? []) as unknown as InvoiceItemRow[],
    totals: totals.data as unknown as InvoiceTotalsRow,
    original,
  };
}

const preceding = (original: InvoiceRow | null) =>
  original?.invoice_no && original.issue_date ? { invoice_no: original.invoice_no, issue_date: original.issue_date } : null;

// ── preview ──────────────────────────────────────────────────────────────────

async function previewInvoice(deps: Deps, render: InvoiceRenderers, invoice: InvoiceRow): Promise<Response> {
  if (invoice.status !== "draft") return json({ error: "invalid_state" }, 409);
  const lines = await loadLines(deps, invoice);
  if (!lines) return json({ error: "load_failed" }, 500);

  // A draft has no snapshots: seller and buyer come from the live rows, in the shape
  // finalize_invoice will snapshot. A cancellation addresses the original's buyer (as finalize does).
  const w = deps.admin.schema("werkbank");
  const [profile, customer, property] = await Promise.all([
    w.from("company_profiles").select("*").eq("org_id", invoice.org_id).maybeSingle(),
    w.from("customers").select("*").eq("org_id", invoice.org_id).eq("id", invoice.customer_id).maybeSingle(),
    invoice.property_id
      ? w.from("properties").select("*").eq("org_id", invoice.org_id).eq("id", invoice.property_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (profile.error || customer.error || property.error || !customer.data) return json({ error: "load_failed" }, 500);
  // The PDF prints the letterhead from the profile; without one there is nothing to preview.
  if (!profile.data) return json({ error: "preflight_failed", blockers: ["profile_incomplete"] }, 422);
  const seller = draftSellerSnapshot(profile.data as unknown as CompanyProfileRow);
  const buyer = (lines.original?.buyer_snapshot as unknown as BuyerSnapshot | null) ??
    draftBuyerSnapshot(customer.data as unknown as CustomerRow, (property.data ?? null) as unknown as PropertyRow | null);

  try {
    const data = buildInvoiceData({
      invoice,
      items: lines.items,
      totals: lines.totals,
      preceding: preceding(lines.original),
      draftFallback: { seller, buyer },
    });
    const bytes = await render.pdf(data, await logoDataUrl(deps, seller.logo_path));
    return json({ pdf_base64: encodeBase64(bytes) });
  } catch (e) {
    console.error("werkbank-invoices: preview render failed", { invoiceId: invoice.id, error: String(e) });
    return json({ error: "render_failed" }, 500);
  }
}

// ── issue ────────────────────────────────────────────────────────────────────

const BLOCKERS: readonly InvoiceBlocker[] = [
  "no_items",
  "no_service_date",
  "profile_incomplete",
  "no_buyer_address",
  "no_recipient",
];

/** The finalize_invoice error as a response (migration 20261008110000). */
function finalizeError(error: { code?: unknown; message?: unknown; details?: unknown }): Response {
  const message = String(error.message ?? "");
  if (message === "invoice_not_ready") {
    const blockers = String(error.details ?? "").split(",").map((b) => b.trim())
      .filter((b): b is InvoiceBlocker => (BLOCKERS as readonly string[]).includes(b));
    return json({ error: "preflight_failed", blockers }, 422);
  }
  if (message === "invalid_transition" || message === "order_not_done") {
    return json({ error: "invalid_state", reason: message }, 409);
  }
  if (error.code === "42501") return json({ error: "forbidden" }, 403);
  return json({ error: "issue_failed" }, 500);
}

/** After the RPC committed: the invoice is issued whatever happens next. */
const afterIssue = (error: string) => json({ error, issued: true }, 500);

async function issueInvoice(
  req: Request,
  deps: Deps,
  render: InvoiceRenderers,
  loaded: InvoiceRow,
  body: Body,
): Promise<Response> {
  let sendInput: SendInput | null = null;
  if (body.send !== undefined && body.send !== null) {
    const parsed = parseSend(body.send);
    if (parsed instanceof Response) return parsed;
    sendInput = parsed;
  }
  if (loaded.pdf_path) return json({ error: "invalid_state" }, 409);
  // Resume renders only the statuses this function issues; any later status (paid, Teil 5) is not ours.
  if (!["draft", "issued", "cancelled"].includes(loaded.status)) return json({ error: "invalid_state" }, 409);

  let invoice = loaded;
  if (invoice.status === "draft") {
    // The caller's JWT (requireOrgRole already checked the header), never the service role:
    // finalize_invoice checks the caller's org role itself.
    const user = deps.userClient(req.headers.get("Authorization") ?? "");
    const { data, error } = await user.schema("werkbank").rpc("finalize_invoice", { p_invoice: invoice.id });
    if (error) return finalizeError(error);
    if (!data) return afterIssue("issue_failed");
    invoice = data as unknown as InvoiceRow;
  }

  const lines = await loadLines(deps, invoice);
  if (!lines) return afterIssue("load_failed");

  let bytes: Uint8Array;
  try {
    const data = buildInvoiceData({
      invoice,
      items: lines.items,
      totals: lines.totals,
      preceding: preceding(lines.original),
    });
    const seller = invoice.seller_snapshot as unknown as SellerSnapshot;
    // einvoice_totals_mismatch (toUblInput's consistency guard) lands here too.
    bytes = await render.einvoice(data, await logoDataUrl(deps, seller.logo_path));
  } catch (e) {
    console.error("werkbank-invoices: issue render failed", { invoiceId: invoice.id, error: String(e) });
    return afterIssue("render_failed");
  }

  const path = `${invoice.org_id}/invoices/${invoice.id}.pdf`;
  const documents = deps.admin.storage.from(DOCUMENTS_BUCKET);
  const { error: upErr } = await documents.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    if (!isAlreadyExists(upErr)) {
      console.error("werkbank-invoices: upload failed", { invoiceId: invoice.id, error: upErr });
      return afterIssue("upload_failed");
    }
    // An earlier attempt stored the file but did not stamp it: that file is the original, so
    // its bytes are what gets stamped (and it is never removed or replaced).
    const { data: file, error: dlErr } = await documents.download(path);
    if (dlErr || !file) {
      console.error("werkbank-invoices: reading the stored file failed", { invoiceId: invoice.id, error: dlErr });
      return afterIssue("upload_failed");
    }
    bytes = new Uint8Array(await (file as Blob).arrayBuffer());
  }

  const { error: updErr } = await deps.admin.schema("werkbank").from("invoices")
    .update({ pdf_path: path, pdf_sha256: await sha256Hex(bytes) })
    // Once: a concurrent resume that stamped first leaves zero rows here, which is fine (same file).
    .eq("id", invoice.id).eq("org_id", invoice.org_id).is("pdf_path", null);
  if (updErr) {
    console.error("werkbank-invoices: stamping the file failed", { invoiceId: invoice.id, error: updErr });
    return afterIssue("update_failed");
  }
  if (!sendInput) return json({ ok: true, invoice_no: invoice.invoice_no });

  // The bytes just stored (or found stored) are the attachment: no second read, no second render.
  const sent = await emailInvoice(deps, { ...invoice, pdf_path: path }, sendInput, bytes, lines);
  if (sent !== "sent") return sendFailure(sent, true);
  return json({ ok: true, invoice_no: invoice.invoice_no, email_sent: true });
}

// ── send ─────────────────────────────────────────────────────────────────────

interface SendInput {
  to: string[];
  cc: string[];
  message: string;
}

const addresses = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((a) => (typeof a === "string" ? a.trim() : "")).filter(Boolean) : [];

/**
 * { to, cc, message } from a send body; a missing recipient is the no_recipient preflight failure,
 * a malformed address 422 invalid_recipient, more than MAX_RECIPIENTS 422 too_many_recipients
 * (the codes werkbank-quotes uses). Runs before finalize, so a bad address never leaves an issued
 * but unsent invoice.
 */
function parseSend(raw: unknown): SendInput | Response {
  const b = isRecord(raw) ? raw : {};
  const to = addresses(b.to);
  if (invoicePreflight({ profile: null, itemCount: 0, serviceDateFrom: null, buyer: null, recipients: to }).includes("no_recipient")) {
    return json({ error: "preflight_failed", blockers: ["no_recipient"] }, 422);
  }
  const checked = checkRecipients(to, addresses(b.cc));
  if ("error" in checked) return json({ error: checked.error }, 422);
  const message = typeof b.message === "string" ? b.message : "";
  if (message.length > MAX_MESSAGE_CHARS) return json({ error: "bad_request" }, 422);
  return { ...checked, message };
}

function sendFailure(error: "load_failed" | "send_failed", issued: boolean): Response {
  return error === "send_failed"
    ? json({ error, issued: true }, 502)
    : json(issued ? { error, issued: true } : { error }, 500);
}

/** The send action: only an invoice whose file is stored (issued, or cancelled and resent). */
async function sendInvoice(deps: Deps, invoice: InvoiceRow, input: SendInput): Promise<Response> {
  if (invoice.status === "draft" || !invoice.pdf_path) return json({ error: "invalid_state" }, 409);
  const sent = await emailInvoice(deps, invoice, input, null);
  if (sent !== "sent") return sendFailure(sent, false);
  return json({ ok: true, email_sent: true });
}

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

/**
 * Emails the stored file, one message per recipient (to, then cc), and stamps sent_at/sent_to when
 * every message went out. `bytes` null means: download the stored file (never render it again).
 */
async function emailInvoice(
  deps: Deps,
  invoice: InvoiceRow,
  input: SendInput,
  bytes: Uint8Array | null,
  loaded: LoadedLines | null = null,
): Promise<"sent" | "load_failed" | "send_failed"> {
  const seller = invoice.seller_snapshot as unknown as SellerSnapshot | null;
  // The issue path passes the lines it just loaded; a plain send reads them.
  const lines = loaded ?? await loadLines(deps, invoice);
  if (!seller || !lines || !invoice.pdf_path) return "load_failed";
  let file = bytes;
  if (!file) {
    const { data, error } = await deps.admin.storage.from(DOCUMENTS_BUCKET).download(invoice.pdf_path);
    if (error || !data) {
      console.error("werkbank-invoices: reading the stored file failed", { invoiceId: invoice.id, error });
      return "load_failed";
    }
    file = new Uint8Array(await (data as Blob).arrayBuffer());
  }

  const cancellation = invoice.type === "cancellation";
  const replyTo = seller.email?.trim();
  // The prefix is admin-editable, so only safe characters reach the attachment name.
  const filename = `${String(invoice.invoice_no).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  const attachment = { filename, content_base64: encodeBase64(file) };
  const recipients = [...input.to, ...input.cc];
  const stamp = deps.now();
  // Keyed on the last completed send, not the clock: a retry after a partial failure (sent_at still
  // unchanged) repeats the keys, so the provider drops the messages that already went out, while a
  // deliberate resend after a success (new sent_at) gets fresh keys.
  const sendRound = invoice.sent_at ?? "first";
  for (const recipient of recipients) {
    const result = await deps.sendEmail({
      template_name: "invoice-sent",
      recipient_email: recipient,
      org_id: invoice.org_id,
      locale: "de",
      ...(replyTo ? { reply_to: replyTo } : {}),
      templateData: {
        companyName: seller.company_name,
        invoiceNo: invoice.invoice_no,
        kind: cancellation ? "cancellation" : "invoice",
        ...(cancellation && lines.original?.invoice_no ? { precedingNo: lines.original.invoice_no } : {}),
        grossFormatted: eur(Number(lines.totals.gross_total ?? 0)),
        dueDateFormatted: invoice.due_date ? formatDateDe(invoice.due_date) : "",
        message: input.message,
      },
      attachments: [attachment],
      idempotency_key: `invoice-sent-${invoice.id}-${sendRound}-${recipient.toLowerCase()}`,
    });
    if (!emailWasSent(result)) {
      console.warn("werkbank-invoices: invoice email not delivered", {
        invoiceId: invoice.id,
        error: result.error ?? (result.data as { reason?: unknown } | null)?.reason,
      });
      return "send_failed";
    }
  }

  const { error } = await deps.admin.schema("werkbank").from("invoices")
    .update({ sent_at: stamp.toISOString(), sent_to: recipients })
    .eq("id", invoice.id).eq("org_id", invoice.org_id);
  // The email is out: a failed stamp must not turn into a resend, so it is logged, not surfaced.
  if (error) console.error("werkbank-invoices: stamping sent_at failed", { invoiceId: invoice.id, error });
  return "sent";
}

// ── download-url ─────────────────────────────────────────────────────────────

async function downloadUrl(deps: Deps, invoice: InvoiceRow): Promise<Response> {
  if (!invoice.pdf_path) return json({ error: "not_found" }, 404);
  const { data, error } = await deps.admin.storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(invoice.pdf_path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return json({ error: "sign_failed" }, 500);
  return json({ url: data.signedUrl });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
