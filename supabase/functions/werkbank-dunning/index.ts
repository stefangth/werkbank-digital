// werkbank-dunning: the dunning notice actions of the Werkbank module (Teil 5, spec R5).
//
// All actions: admin or producer of the org (requireOrgRole), handwerk orgs only.
//   preview      { org_id, invoice_id, payment_deadline? }                    -> application/pdf (watermark, persists nothing)
//   issue        { org_id, invoice_id, delivery, payment_deadline? }          -> { notice_id, stage }
//   send         { org_id, notice_id, to?, cc?, message? }                    -> { ok: true, email_sent: true }
//   download-url { org_id, notice_id }                                        -> { url }  (60 s)
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
//   * `send` (R6) emails the STORED notice and the STORED invoice file (downloaded, never rendered) as the
//     two attachments of a dunning-sent message per recipient (to, then cc), reply_to = the profile email,
//     then stamps sent_at and sent_to (service role: lock_dunning_notice). Without `to` the recipient is
//     defaultRecipient(customer, contact) of the invoice; none is 409 no_recipient. issue with
//     `send: { to?, cc?, message? }` (or `send: true`) and delivery "email" runs it after the file is
//     stored; recipients and the invoice file are checked BEFORE the RPC, so a notice is never issued
//     for a send that cannot go out. A failed email answers 502 { error: "send_failed", issued: true }
//     (the notice stays stored; the UI offers send). delivery "print" ignores `send` and never emails.
//
// Resume with send and `send` re-check the business blockers first (an issued invoice, an open
// amount, no active hold): 409 { error: "not_allowed", blockers }. A resume without send still stores.
// payment_deadline must be a calendar date not before Berlin today (400 bad_request); preview needs
// an issued invoice (409 not_issued).
//
// verify_jwt = true in config.toml: there are no public actions here.
// DI: exports handle(req, deps, render); Deno.serve wiring at the bottom.

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { type Deps, emailWasSent, realDeps } from "../_shared/deps.ts";
import { corsHeaders, json, preflight } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { resolveOrgKind } from "../_shared/orgKind.ts";
import { WERKBANK_ORG_KIND } from "../_shared/werkbank/registry.ts";
import { sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import { DOCUMENTS_BUCKET, isAlreadyExists, logoDataUrl } from "../_shared/werkbank/documentStorage.ts";
import type { CompanyProfileRow, InvoiceRow, SellerSnapshot } from "../_shared/werkbank/einvoice/invoiceData.ts";
import { buildDunningData, type DunningData, type DunningNoticeRow } from "../_shared/werkbank/pdf/dunningData.ts";
import { renderDunningPdf } from "../_shared/werkbank/pdf/dunningDocument.tsx";
import { DUNNING_STAGE_TITLES, type DunningBlocker } from "../_shared/werkbank/dunningDefaults.ts";
import { defaultRecipient } from "../_shared/werkbank/defaultRecipient.ts";
import { checkRecipients, MAX_MESSAGE_CHARS, parseAddresses } from "../_shared/werkbank/recipients.ts";
import { formatDateDe } from "../_shared/werkbank/pdf/quoteData.ts";

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
type Action = "preview" | "issue" | "send" | "download-url";

const isRecord = (v: unknown): v is Body => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD (2026-02-30 is not). */
function isCalendarDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

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
  if (action !== "preview" && action !== "issue" && action !== "send" && action !== "download-url") {
    return json({ error: "unknown_action" }, 400);
  }

  const orgId = str(body.org_id);
  const invoiceId = str(body.invoice_id);
  const noticeId = str(body.notice_id);
  const byNotice = action === "download-url" || action === "send";
  if (!orgId || (byNotice ? !noticeId : !invoiceId)) return json({ error: "bad_request" }, 400);

  // Validated before any write; absent means the profile default.
  let deadline: string | null = null;
  if (body.payment_deadline !== undefined && body.payment_deadline !== null) {
    deadline = str(body.payment_deadline);
    if (!deadline || !isCalendarDate(deadline) || deadline < berlinToday(deps.now())) {
      return json({ error: "bad_request" }, 400);
    }
  }
  let delivery: "email" | "print" = "email";
  if (action === "issue") {
    if (body.delivery !== "email" && body.delivery !== "print") return json({ error: "bad_request" }, 400);
    delivery = body.delivery;
  }
  // Validated before any write. Print never emails, so its `send` field is not even read.
  let sendInput: SendInput | null = null;
  if (action === "send" || (action === "issue" && delivery === "email")) {
    const parsed = parseSend(action === "send" ? body : body.send);
    if (parsed instanceof Response) return parsed;
    sendInput = parsed;
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
    case "send":
      return sendNotice(deps, orgId, noticeId!, sendInput!);
    case "preview":
    case "issue": {
      const invoice = await loadInvoice(deps, orgId, invoiceId!);
      if (invoice === "error") return json({ error: "load_failed" }, 500);
      if (!invoice) return json({ error: "not_found" }, 404);
      return action === "preview"
        ? previewNotice(deps, render, invoice, deadline)
        : issueNotice(req, deps, render, invoice, delivery, deadline, sendInput);
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
  if (invoice.type !== "invoice" || invoice.status !== "issued") return json({ error: "not_allowed", blockers: ["not_issued"] }, 409);
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
  sendInput: SendInput | null,
): Promise<Response> {
  const ctx = await loadContext(deps, invoice);
  if (typeof ctx === "string") return contextError(ctx);

  // A requested send is checked before the RPC draws a stage: no notice for a send that cannot go out.
  let target: Recipients | null = null;
  if (sendInput) {
    const prepared = await prepareSend(deps, invoice, sendInput);
    if (prepared instanceof Response) return prepared;
    target = prepared;
  }

  // Resume: a notice without a file is stored as it is, the RPC is not called again. Storing it is
  // always allowed; emailing it is not once the invoice is settled, held or cancelled (the RPC that
  // checked this ran before, so the business blockers are checked again here).
  let notice = ctx.notices.find((n) => !n.pdf_path) ?? null;
  if (notice && target) {
    const blocked = await sendBlocked(deps, invoice, ctx.balance);
    if (blocked) return blocked;
  }
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
  if (!target || !sendInput) return json({ notice_id: notice.id, stage: notice.stage });

  const sent = await emailNotice(deps, { ...notice, pdf_path: path }, invoice, target, sendInput.message, ctx.profile.email, bytes);
  if (sent !== "sent") return sendFailure(sent);
  return json({ notice_id: notice.id, stage: notice.stage, email_sent: true });
}

// ── send ─────────────────────────────────────────────────────────────────────

interface SendInput {
  /** Empty: the invoice's default recipient. */
  to: string[];
  cc: string[];
  message: string;
}
interface Recipients {
  to: string[];
  cc: string[];
}

/**
 * { to, cc, message } from a send body. null (no `send` on an issue) or false means: do not send;
 * true means defaults. A malformed address is 422 invalid_recipient, more than MAX_RECIPIENTS 422
 * too_many_recipients, an over-long message 422 bad_request (the codes werkbank-invoices uses).
 */
function parseSend(raw: unknown): SendInput | null | Response {
  if (raw === undefined || raw === null || raw === false) return null;
  const b = raw === true ? {} : isRecord(raw) ? raw : null;
  if (!b) return json({ error: "bad_request" }, 400);
  const message = typeof b.message === "string" ? b.message : "";
  if (message.length > MAX_MESSAGE_CHARS) return json({ error: "bad_request" }, 422);
  const to = parseAddresses(b.to);
  const cc = parseAddresses(b.cc);
  // Explicit addresses are validated now; the default recipient is validated once it is known.
  const checked = checkRecipients(to, cc);
  if ("error" in checked) return json({ error: checked.error }, 422);
  return { ...checked, message };
}

/** The recipients (explicit, else the invoice's default) and the check that the invoice file exists. */
async function prepareSend(deps: Deps, invoice: InvoiceRow, input: SendInput): Promise<Recipients | Response> {
  if (!invoice.pdf_path) return json({ error: "invoice_file_missing" }, 409);
  let to = input.to;
  if (to.length === 0) {
    const w = deps.admin.schema("werkbank");
    const [customer, contact] = await Promise.all([
      invoice.customer_id
        ? w.from("customers").select("invoice_email, email").eq("id", invoice.customer_id).eq("org_id", invoice.org_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      invoice.contact_id
        ? w.from("contacts").select("email").eq("id", invoice.contact_id).eq("org_id", invoice.org_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (customer.error || contact.error) return json({ error: "load_failed" }, 500);
    const fallback = defaultRecipient(
      customer.data as { invoice_email?: string | null; email?: string | null } | null,
      contact.data as { email?: string | null } | null,
    );
    if (!fallback) return json({ error: "no_recipient" }, 409);
    to = [fallback];
  }
  const checked = checkRecipients(to, input.cc);
  if ("error" in checked) return json({ error: checked.error }, 422);
  return checked;
}

/**
 * The business blockers that forbid emailing a notice of this invoice now: not an issued invoice
 * (not_issued), nothing open (nothing_open) or an active hold (on_hold: until null or not before
 * Berlin today). The same names and rule as create_dunning_notice. null when the email may go out,
 * else the 409 response.
 */
async function sendBlocked(
  deps: Deps,
  invoice: InvoiceRow,
  balance: { open_amount: number | null } | null,
): Promise<Response | null> {
  const { data: hold, error } = await deps.admin.schema("werkbank").from("dunning_holds")
    .select("until").eq("invoice_id", invoice.id).eq("org_id", invoice.org_id).maybeSingle();
  if (error) return json({ error: "load_failed" }, 500);
  const blockers: DunningBlocker[] = [];
  if (invoice.type !== "invoice" || invoice.status !== "issued") blockers.push("not_issued");
  if (!(Number(balance?.open_amount ?? 0) > 0)) blockers.push("nothing_open");
  const until = (hold as { until: string | null } | null)?.until;
  if (hold && (until === null || until === undefined || until >= berlinToday(deps.now()))) blockers.push("on_hold");
  return blockers.length > 0 ? json({ error: "not_allowed", blockers }, 409) : null;
}

function sendFailure(error: "load_failed" | "send_failed"): Response {
  return error === "send_failed" ? json({ error, issued: true }, 502) : json({ error, issued: true }, 500);
}

/** The send action: only a notice whose file is stored, for an invoice whose file is stored. */
async function sendNotice(deps: Deps, orgId: string, noticeId: string, input: SendInput): Promise<Response> {
  const w = deps.admin.schema("werkbank");
  const { data, error } = await w.from("dunning_notices").select("*").eq("id", noticeId).eq("org_id", orgId).maybeSingle();
  if (error) return json({ error: "load_failed" }, 500);
  if (!data) return json({ error: "not_found" }, 404);
  const notice = data as unknown as DunningNoticeRow;
  if (!notice.pdf_path) return json({ error: "pdf_missing" }, 409);

  const invoice = await loadInvoice(deps, orgId, notice.invoice_id);
  if (invoice === "error") return json({ error: "load_failed" }, 500);
  if (!invoice) return json({ error: "not_found" }, 404);
  const balance = await w.from("invoice_balances").select("open_amount").eq("invoice_id", invoice.id).maybeSingle();
  if (balance.error) return json({ error: "load_failed" }, 500);
  const blocked = await sendBlocked(deps, invoice, balance.data as { open_amount: number | null } | null);
  if (blocked) return blocked;
  const target = await prepareSend(deps, invoice, input);
  if (target instanceof Response) return target;

  const profile = await w.from("company_profiles").select("email").eq("org_id", orgId).maybeSingle();
  if (profile.error) return json({ error: "load_failed" }, 500);
  const replyTo = (profile.data as { email?: string | null } | null)?.email;

  const sent = await emailNotice(deps, notice, invoice, target, input.message, replyTo, null);
  if (sent !== "sent") return sendFailure(sent);
  return json({ ok: true, email_sent: true });
}

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

async function readStored(deps: Deps, path: string, what: string, id: string): Promise<Uint8Array | null> {
  const { data, error } = await deps.admin.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) {
    console.error(`werkbank-dunning: reading the stored ${what} failed`, { id, error });
    return null;
  }
  return new Uint8Array(await (data as Blob).arrayBuffer());
}

/** Reduces the admin-editable invoice number to characters that are safe in an attachment name. */
const safeName = (s: string) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * Emails the stored notice and the stored invoice, one message per recipient (to, then cc), and
 * stamps sent_at/sent_to when every message went out. `bytes` null means: download the stored notice.
 */
async function emailNotice(
  deps: Deps,
  notice: DunningNoticeRow,
  invoice: InvoiceRow,
  target: Recipients,
  message: string,
  replyTo: string | null | undefined,
  bytes: Uint8Array | null,
): Promise<"sent" | "load_failed" | "send_failed"> {
  const seller = invoice.seller_snapshot as unknown as SellerSnapshot | null;
  const invoiceNo = invoice.invoice_no;
  if (!seller || !invoiceNo || !notice.pdf_path || !invoice.pdf_path) return "load_failed";
  const noticeFile = bytes ?? await readStored(deps, notice.pdf_path, "notice", notice.id);
  const invoiceFile = await readStored(deps, invoice.pdf_path, "invoice", invoice.id);
  if (!noticeFile || !invoiceFile) return "load_failed";

  const no = safeName(invoiceNo);
  const attachments = [
    { filename: `Mahnung-${no}-${notice.stage}.pdf`, content_base64: encodeBase64(noticeFile) },
    { filename: `Rechnung-${no}.pdf`, content_base64: encodeBase64(invoiceFile) },
  ];
  const stage = notice.stage as 1 | 2 | 3;
  const recipients = [...target.to, ...target.cc];
  const reply = replyTo?.trim();
  // Keyed on the last completed send and the text, not the clock: a retry after a partial failure
  // (sent_at unchanged, same text) repeats the keys, so the provider drops the messages that already
  // went out, while a changed text or a deliberate resend after a success (new sent_at) gets fresh keys.
  const sendRound = `${notice.sent_at ?? "first"}-${(await sha256Hex(message)).slice(0, 16)}`;
  for (const recipient of recipients) {
    const result = await deps.sendEmail({
      template_name: "dunning-sent",
      recipient_email: recipient,
      org_id: notice.org_id,
      locale: "de",
      ...(reply ? { reply_to: reply } : {}),
      templateData: {
        companyName: seller.company_name,
        stageTitle: DUNNING_STAGE_TITLES[stage],
        invoiceNo,
        openAmount: eur(Number(notice.open_amount ?? 0)),
        paymentDeadline: formatDateDe(notice.payment_deadline),
        message,
      },
      attachments,
      idempotency_key: `dunning-sent-${notice.id}-${sendRound}-${recipient.toLowerCase()}`,
    });
    if (!emailWasSent(result)) {
      console.warn("werkbank-dunning: dunning email not delivered", {
        noticeId: notice.id,
        error: result.error ?? (result.data as { reason?: unknown } | null)?.reason,
      });
      return "send_failed";
    }
  }

  const { error } = await deps.admin.schema("werkbank").from("dunning_notices")
    .update({ sent_at: deps.now().toISOString(), sent_to: recipients })
    .eq("id", notice.id).eq("org_id", notice.org_id);
  // The email is out: a failed stamp must not turn into a resend, so it is logged, not surfaced.
  if (error) console.error("werkbank-dunning: stamping sent_at failed", { noticeId: notice.id, error });
  return "sent";
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
