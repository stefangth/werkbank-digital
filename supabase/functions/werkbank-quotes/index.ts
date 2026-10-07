// werkbank-quotes: the quote document actions of the Werkbank module (spec R6).
//
// Internal actions (admin or producer of the org, handwerk orgs only):
//   preview      { org_id, quote_id }                      -> { pdf_base64 }       (persists nothing)
//   send         { org_id, quote_id, to[], cc[], message } -> { ok, email_sent }
//   resend       { org_id, quote_id, to[], cc[], message } -> { ok, email_sent }   (sent quotes only)
//   download-url { org_id, quote_id, kind }                -> { url }              (600 s)
//
// Public actions (no login; the link token is the credential, looked up by its SHA-256):
//   view   { token } -> { quote, seller, items, totals, pdf_url, consent_text }
//   decide { token, decision, signer_name, signature?, comment?, consent } -> { ok, pdf_url? }
//   Both answer 404 not_found or 410 superseded | revoked | decided | expired, checked in that order.
//
// verify_jwt = false in config.toml because the public token actions live here too; the
// internal actions authorize the caller themselves through requireOrgRole.
//
// Send order is fixed: render, upload, ONE service-role update (status, sent_at, sent_to,
// pdf_path, pdf_sha256, access_token_hash), then the emails. Only the service role may write
// those columns (lock_quote trigger), so the update runs on deps.admin. A failed email does
// not roll the quote back: it stays sent, the response says email_sent: false and the UI
// offers "Erneut senden".
//
// DI: exports handle(req, deps, render); Deno.serve wiring at the bottom.

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { realDeps, emailWasSent, type Deps } from "../_shared/deps.ts";
import { json, preflight } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { resolveOrgKind } from "../_shared/orgKind.ts";
import { appUrl } from "../_shared/app-url.ts";
import { brandAppUrl, brandForKind } from "../_shared/brand.ts";
import { berlinDateKey } from "../_shared/tierFill.ts";
import { WERKBANK_ORG_KIND } from "../_shared/werkbank/registry.ts";
import { quotePreflight } from "../_shared/werkbank/quotePreflight.ts";
import { newQuoteToken, sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import {
  buildQuotePdfData,
  customerName,
  type CustomerRow,
  type ItemRow,
  formatDateDe,
  type ProfileRow,
  type PropertyRow,
  type QuotePdfData,
  type QuoteRow,
  type TotalsRow,
} from "../_shared/werkbank/pdf/quoteData.ts";
import { renderQuotePdf } from "../_shared/werkbank/pdf/quoteDocument.tsx";
import { parseName, parseSignature, quoteConsentText } from "../_shared/werkbank/acceptance.ts";

export type RenderQuotePdf = (data: QuotePdfData) => Promise<Uint8Array>;

const DOCUMENTS_BUCKET = "werkbank-documents";
const ASSETS_BUCKET = "werkbank-assets";
const SIGNED_URL_TTL = 600;
const MAX_RECIPIENTS = 10;
const MAX_MESSAGE_CHARS = 5000;
// Same shape as REPLY_TO_RE in send-transactional-email and the company_profiles.email check.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Body = Record<string, unknown>;

const isRecord = (v: unknown): v is Body => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export async function handle(req: Request, deps: Deps, render: RenderQuotePdf = renderQuotePdf): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => null);
  if (!isRecord(body) || typeof body.action !== "string") return json({ error: "bad_request" }, 400);

  switch (body.action) {
    case "preview":
    case "send":
    case "resend":
    case "download-url":
      return internal(req, deps, render, body.action, body);
    case "view":
    case "decide":
      return publicAction(req, deps, render, body.action, body);
    default:
      return json({ error: "unknown_action" }, 400);
  }
}

// ── internal actions ─────────────────────────────────────────────────────────

type InternalAction = "preview" | "send" | "resend" | "download-url";

async function internal(req: Request, deps: Deps, render: RenderQuotePdf, action: InternalAction, body: Body) {
  const orgId = str(body.org_id);
  const quoteId = str(body.quote_id);
  if (!orgId || !quoteId) return json({ error: "bad_request" }, 400);

  const gate = await requireOrgRole(deps, req, orgId, ["admin", "producer"]);
  if (!gate.ok) {
    return gate.response.status === 403 ? json({ error: "forbidden" }, 403) : json({ error: "unauthorized" }, 401);
  }
  if ((await resolveOrgKind(deps.admin, orgId)) !== WERKBANK_ORG_KIND.kind) {
    return json({ error: "not_handwerk" }, 403);
  }

  const { data: quoteData, error: quoteErr } = await deps.admin.schema("werkbank").from("quotes")
    .select("*").eq("id", quoteId).eq("org_id", orgId).maybeSingle();
  if (quoteErr) return json({ error: "load_failed" }, 500);
  if (!quoteData) return json({ error: "not_found" }, 404);
  const quote = quoteData as unknown as QuoteRow;

  switch (action) {
    case "preview":
      return previewQuote(deps, render, quote);
    case "send":
      return sendQuote(deps, render, quote, body);
    case "resend":
      return resendQuote(deps, quote, body);
    case "download-url":
      return downloadUrl(deps, quote, body);
  }
}

interface LoadedDocument {
  items: ItemRow[];
  totals: TotalsRow;
  customer: CustomerRow;
  property: PropertyRow | null;
  profile: ProfileRow | null;
}

async function loadDocument(deps: Deps, quote: QuoteRow): Promise<LoadedDocument | null> {
  const w = deps.admin.schema("werkbank");
  const [items, totals, customer, property, profile] = await Promise.all([
    w.from("document_items").select("*").eq("org_id", quote.org_id).eq("quote_id", quote.id).order("sort_order"),
    w.from("document_totals").select("*").eq("quote_id", quote.id).maybeSingle(),
    w.from("customers").select("*").eq("org_id", quote.org_id).eq("id", quote.customer_id).maybeSingle(),
    quote.property_id
      ? w.from("properties").select("*").eq("org_id", quote.org_id).eq("id", quote.property_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    w.from("company_profiles").select("*").eq("org_id", quote.org_id).maybeSingle(),
  ]);
  if (items.error || totals.error || customer.error || property.error || profile.error) return null;
  if (!customer.data || !totals.data) return null;
  return {
    items: (items.data ?? []) as unknown as ItemRow[],
    totals: totals.data as unknown as TotalsRow,
    customer: customer.data as unknown as CustomerRow,
    property: (property.data ?? null) as unknown as PropertyRow | null,
    profile: (profile.data ?? null) as unknown as ProfileRow | null,
  };
}

/** Storage's "object exists" answer to an upload with upsert: false. */
function isAlreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown };
  return String(e.statusCode) === "409" || e.status === 409 || /already exists/i.test(String(e.message ?? ""));
}

const itemCount = (items: ItemRow[]) => items.filter((i) => i.kind === "item").length;

/** The org's logo as a data URL for the PDF, or undefined when there is none or it cannot be read. */
async function logoDataUrl(deps: Deps, path: string | null | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const { data, error } = await deps.admin.storage.from(ASSETS_BUCKET).download(path);
    if (error || !data) return undefined;
    const blob = data as Blob;
    const lower = path.toLowerCase();
    const mime = blob.type?.startsWith("image/")
      ? blob.type
      : lower.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(lower) ? "image/jpeg" : null;
    if (!mime) return undefined;
    return `data:${mime};base64,${encodeBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  } catch {
    return undefined;
  }
}

async function renderDocument(
  deps: Deps,
  render: RenderQuotePdf,
  quote: QuoteRow,
  doc: LoadedDocument & { profile: ProfileRow },
  watermark?: "Entwurf",
): Promise<Uint8Array> {
  const data = buildQuotePdfData({
    quote,
    items: doc.items,
    totals: doc.totals,
    customer: doc.customer,
    property: doc.property,
    profile: doc.profile,
    logoDataUrl: await logoDataUrl(deps, doc.profile.logo_path),
    // The document date is the Berlin calendar day, never the UTC one.
    date: formatDateDe(berlinDateKey(deps.now())),
    watermark,
  });
  return await render(data);
}

async function previewQuote(deps: Deps, render: RenderQuotePdf, quote: QuoteRow): Promise<Response> {
  const doc = await loadDocument(deps, quote);
  if (!doc) return json({ error: "load_failed" }, 500);
  // The PDF prints the letterhead from the profile; without one there is nothing to preview.
  if (!doc.profile) return json({ error: "preflight_failed", blockers: ["profile_incomplete"] }, 422);
  try {
    const bytes = await renderDocument(deps, render, quote, { ...doc, profile: doc.profile }, "Entwurf");
    return json({ pdf_base64: encodeBase64(bytes) });
  } catch (e) {
    console.error("werkbank-quotes: preview render failed", { quoteId: quote.id, error: String(e) });
    return json({ error: "render_failed" }, 500);
  }
}

interface SendInput {
  to: string[];
  cc: string[];
  message: string;
}

/** Trimmed, de-duplicated (case-insensitively, `to` first) and shape-checked recipients. */
function parseSendInput(body: Body): SendInput | { error: string } {
  const list = (v: unknown): string[] | null => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return null;
    return (v as string[]).map((x) => x.trim()).filter((x) => x !== "");
  };
  const to = list(body.to);
  const cc = list(body.cc);
  if (!to || !cc) return { error: "bad_request" };
  if (body.message !== undefined && body.message !== null && typeof body.message !== "string") {
    return { error: "bad_request" };
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length > MAX_MESSAGE_CHARS) return { error: "bad_request" };
  if ([...to, ...cc].some((a) => !EMAIL_RE.test(a))) return { error: "invalid_recipient" };
  const seen = new Set<string>();
  const unique = (addrs: string[]) =>
    addrs.filter((a) => {
      const key = a.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const uniqueTo = unique(to);
  const uniqueCc = unique(cc);
  if (uniqueTo.length + uniqueCc.length > MAX_RECIPIENTS) return { error: "too_many_recipients" };
  return { to: uniqueTo, cc: uniqueCc, message };
}

async function sendQuote(deps: Deps, render: RenderQuotePdf, quote: QuoteRow, body: Body): Promise<Response> {
  if (quote.status !== "draft") return json({ error: "invalid_state" }, 409);
  const input = parseSendInput(body);
  if ("error" in input) return json({ error: input.error }, 400);

  const doc = await loadDocument(deps, quote);
  if (!doc) return json({ error: "load_failed" }, 500);
  const blockers = quotePreflight({
    profile: doc.profile,
    itemCount: itemCount(doc.items),
    recipients: input.to,
    validUntil: quote.valid_until,
    today: berlinDateKey(deps.now()),
  });
  if (blockers.length > 0 || !doc.profile) return json({ error: "preflight_failed", blockers }, 422);
  const profile = doc.profile;

  let bytes: Uint8Array;
  try {
    bytes = await renderDocument(deps, render, quote, { ...doc, profile });
  } catch (e) {
    console.error("werkbank-quotes: send render failed", { quoteId: quote.id, error: String(e) });
    return json({ error: "render_failed" }, 500);
  }

  // Content-addressed and never overwritten: a concurrent losing send cannot replace the
  // winner's bytes, so the stored PDF always matches pdf_sha256 (the acceptance evidence).
  const pdfSha256 = await sha256Hex(bytes);
  const path = `${quote.org_id}/quotes/${quote.id}-${pdfSha256.slice(0, 16)}.pdf`;
  const documents = deps.admin.storage.from(DOCUMENTS_BUCKET);
  const { error: upErr } = await documents.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    // The same bytes are already stored: another send of this very document is under way.
    if (isAlreadyExists(upErr)) return json({ error: "invalid_state" }, 409);
    console.error("werkbank-quotes: upload failed", { quoteId: quote.id, error: upErr });
    return json({ error: "upload_failed" }, 500);
  }
  const discardUpload = async () => {
    const { error } = await documents.remove([path]);
    if (error) console.warn("werkbank-quotes: could not remove an unused upload", { quoteId: quote.id, path, error });
  };

  const { token, hash } = await newQuoteToken();
  const recipients = [...input.to, ...input.cc];
  const { data: stamped, error: updErr } = await deps.admin.schema("werkbank").from("quotes")
    .update({
      status: "sent",
      sent_at: deps.now().toISOString(),
      sent_to: recipients,
      pdf_path: path,
      pdf_sha256: pdfSha256,
      access_token_hash: hash,
    })
    // Only the draft that was rendered: a concurrent send or an edit since loading yields 409.
    .eq("id", quote.id).eq("org_id", quote.org_id).eq("status", "draft").eq("updated_at", quote.updated_at)
    .select("id").maybeSingle();
  if (updErr) {
    console.error("werkbank-quotes: stamping the quote failed", { quoteId: quote.id, error: updErr });
    await discardUpload();
    return json({ error: "update_failed" }, 500);
  }
  if (!stamped) {
    await discardUpload();
    return json({ error: "invalid_state" }, 409);
  }

  const emailSent = await emailQuote(deps, quote, profile, recipients, input.message, token, bytes, hash);
  return json({ ok: true, email_sent: emailSent });
}

async function resendQuote(deps: Deps, quote: QuoteRow, body: Body): Promise<Response> {
  if (quote.status !== "sent") return json({ error: "invalid_state" }, 409);
  const input = parseSendInput(body);
  if ("error" in input) return json({ error: input.error }, 400);
  if (!quote.pdf_path) return json({ error: "pdf_missing" }, 500);

  const doc = await loadDocument(deps, quote);
  if (!doc) return json({ error: "load_failed" }, 500);
  const blockers = quotePreflight({
    profile: doc.profile,
    itemCount: itemCount(doc.items),
    recipients: input.to,
    validUntil: quote.valid_until,
    today: berlinDateKey(deps.now()),
  });
  if (blockers.length > 0 || !doc.profile) return json({ error: "preflight_failed", blockers }, 422);
  const profile = doc.profile;

  // The customer gets the document that was sent, byte for byte (its hash is on the quote).
  const { data: file, error: dlErr } = await deps.admin.storage.from(DOCUMENTS_BUCKET).download(quote.pdf_path);
  if (dlErr || !file) return json({ error: "pdf_missing" }, 500);
  const bytes = new Uint8Array(await (file as Blob).arrayBuffer());

  // A new token: the old link stops working. A revoked link is replaced by a working one.
  const { token, hash } = await newQuoteToken();
  const recipients = [...input.to, ...input.cc];
  const { data: stamped, error: updErr } = await deps.admin.schema("werkbank").from("quotes")
    .update({ access_token_hash: hash, sent_to: recipients, link_revoked_at: null })
    .eq("id", quote.id).eq("org_id", quote.org_id).eq("status", "sent")
    .select("id").maybeSingle();
  if (updErr) {
    console.error("werkbank-quotes: new token failed", { quoteId: quote.id, error: updErr });
    return json({ error: "update_failed" }, 500);
  }
  if (!stamped) return json({ error: "invalid_state" }, 409);

  const emailSent = await emailQuote(deps, quote, profile, recipients, input.message, token, bytes, hash);
  return json({ ok: true, email_sent: emailSent });
}

/** Sends quote-sent to every recipient (one message each). True only when all were delivered. */
async function emailQuote(
  deps: Deps,
  quote: QuoteRow,
  profile: ProfileRow,
  recipients: string[],
  message: string,
  token: string,
  bytes: Uint8Array,
  tokenHash: string,
): Promise<boolean> {
  const base = brandAppUrl(brandForKind(WERKBANK_ORG_KIND.kind), appUrl(deps.env));
  const link = `${base}/quote/${token}`;
  const replyTo = profile.email?.trim();
  const attachment = { filename: `Angebot-${quote.quote_no}.pdf`, content_base64: encodeBase64(bytes) };
  let allSent = true;
  for (const [i, recipient] of recipients.entries()) {
    const result = await deps.sendEmail({
      template_name: "quote-sent",
      recipient_email: recipient,
      org_id: quote.org_id,
      // Customer emails are German whatever language the office uses.
      locale: "de",
      ...(replyTo ? { reply_to: replyTo } : {}),
      templateData: {
        quote_no: quote.quote_no,
        company_name: profile.company_name,
        subject: quote.subject ?? "",
        valid_until: formatDateDe(quote.valid_until),
        message,
        link,
      },
      attachments: [attachment],
      idempotency_key: `quote-sent-${quote.id}-${tokenHash.slice(0, 16)}-${i}`,
    });
    if (!emailWasSent(result)) {
      allSent = false;
      console.warn("werkbank-quotes: quote email not delivered", {
        quoteId: quote.id,
        error: result.error ?? (result.data as { reason?: unknown } | null)?.reason,
      });
    }
  }
  return allSent;
}

async function downloadUrl(deps: Deps, quote: QuoteRow, body: Body): Promise<Response> {
  const kind = body.kind;
  if (kind !== "sent" && kind !== "accepted") return json({ error: "bad_request" }, 400);
  const path = kind === "sent" ? quote.pdf_path : quote.accepted_pdf_path;
  if (!path) return json({ error: "not_found" }, 404);
  const { data, error } = await deps.admin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return json({ error: "sign_failed" }, 500);
  return json({ url: data.signedUrl });
}

// ── public actions ───────────────────────────────────────────────────────────

type PublicAction = "view" | "decide";
type Decision = "accepted" | "rejected";

const TOKEN_RE = /^[0-9a-f]{64}$/;
const MAX_COMMENT_CHARS = 2000;

/** What a link may still do: open, or one of the states the public page explains. */
type LinkState =
  | { open: true }
  | { open: false; status: 404 | 410; error: "not_found" | "superseded" | "revoked" | "decided" | "expired" };

/** The binding order: superseded, revoked, decided, expired (sent and past its Berlin date). */
function linkState(quote: QuoteRow | null, today: string): LinkState {
  if (!quote) return { open: false, status: 404, error: "not_found" };
  if (quote.status === "superseded") return { open: false, status: 410, error: "superseded" };
  if (quote.link_revoked_at) return { open: false, status: 410, error: "revoked" };
  if (quote.status === "accepted" || quote.status === "rejected") return { open: false, status: 410, error: "decided" };
  if (quote.status !== "sent") return { open: false, status: 404, error: "not_found" };
  if (quote.valid_until < today) return { open: false, status: 410, error: "expired" };
  return { open: true };
}

/** The 404/410 answer for a closed link; a decided one carries the decision and its PDF. */
async function closedResponse(
  deps: Deps,
  quote: QuoteRow | null,
  state: Exclude<LinkState, { open: true }>,
): Promise<Response> {
  if (state.error !== "decided" || !quote) return json({ error: state.error }, state.status);
  const decision = quote.status as Decision;
  const pdfUrl = decision === "accepted" && quote.accepted_pdf_path
    ? await signedUrl(deps, DOCUMENTS_BUCKET, quote.accepted_pdf_path)
    : null;
  return json({ error: "decided", decision, ...(pdfUrl ? { pdf_url: pdfUrl } : {}) }, 410);
}

async function signedUrl(deps: Deps, bucket: string, path: string): Promise<string | null> {
  const { data, error } = await deps.admin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

async function publicAction(req: Request, deps: Deps, render: RenderQuotePdf, action: PublicAction, body: Body) {
  // Only a well-formed token is hashed and looked up; anything else is simply unknown.
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_RE.test(token)) return json({ error: "not_found" }, 404);

  const { data, error } = await deps.admin.schema("werkbank").from("quotes")
    .select("*").eq("access_token_hash", await sha256Hex(token)).maybeSingle();
  if (error) return json({ error: "load_failed" }, 500);
  const quote = (data ?? null) as unknown as QuoteRow | null;
  const state = linkState(quote, berlinDateKey(deps.now()));
  if (!state.open || !quote) return closedResponse(deps, quote, state as Exclude<LinkState, { open: true }>);

  return action === "view" ? viewQuote(deps, quote) : decideQuote(req, deps, render, quote, body);
}

/** The sent document's date: the Berlin day of sent_at, as printed when it was sent. */
const sentDateKey = (quote: QuoteRow) => berlinDateKey(quote.sent_at ? new Date(quote.sent_at) : new Date());

/** Display data only: what the PDF prints, never the customer's email or phone or any id. */
async function viewQuote(deps: Deps, quote: QuoteRow): Promise<Response> {
  const doc = await loadDocument(deps, quote);
  if (!doc || !doc.profile) return json({ error: "load_failed" }, 500);
  if (!quote.pdf_path) return json({ error: "pdf_missing" }, 500);
  const printed = buildQuotePdfData({
    quote,
    items: doc.items,
    totals: doc.totals,
    customer: doc.customer,
    property: doc.property,
    profile: doc.profile,
  });
  const [pdfUrl, logoUrl] = await Promise.all([
    signedUrl(deps, DOCUMENTS_BUCKET, quote.pdf_path),
    doc.profile.logo_path ? signedUrl(deps, ASSETS_BUCKET, doc.profile.logo_path) : Promise.resolve(null),
  ]);
  if (!pdfUrl) return json({ error: "sign_failed" }, 500);
  const { logoDataUrl: _logo, ...seller } = printed.seller;
  return json({
    quote: {
      quote_no: quote.quote_no,
      version: quote.version,
      status: quote.status,
      date: sentDateKey(quote),
      valid_until: quote.valid_until,
      subject: printed.subject,
      intro: printed.intro,
      closing: printed.closing,
      payment_terms: printed.paymentTerms,
      recipient_lines: printed.recipient.lines,
      location_lines: printed.location,
    },
    seller: {
      company_name: seller.companyName,
      legal_form: seller.legalForm ?? null,
      street: seller.street,
      postal_code: seller.postalCode,
      city: seller.city,
      phone: seller.phone ?? null,
      email: seller.email ?? null,
      website: seller.website ?? null,
      logo_url: logoUrl,
    },
    items: printed.sections,
    totals: printed.totals,
    pdf_url: pdfUrl,
    consent_text: quoteConsentText(quote.quote_no),
  });
}

async function decideQuote(
  req: Request,
  deps: Deps,
  render: RenderQuotePdf,
  quote: QuoteRow,
  body: Body,
): Promise<Response> {
  const decision = body.decision;
  if (decision !== "accepted" && decision !== "rejected") return json({ error: "bad_request" }, 400);
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== "string") {
    return json({ error: "bad_request" }, 400);
  }
  const comment = typeof body.comment === "string" && body.comment.trim() !== ""
    ? body.comment.trim().slice(0, MAX_COMMENT_CHARS)
    : null;
  const signerName = parseName(body.signer_name);
  if (!signerName) return json({ error: "invalid_signer_name" }, 422);
  const signature = decision === "accepted" ? parseSignature(body.signature) : null;
  if (decision === "accepted" && !signature) return json({ error: "invalid_signature" }, 422);
  // Consent is the acceptance declaration; a rejection declares nothing to consent to.
  if (decision === "accepted" && body.consent !== true) return json({ error: "consent_required" }, 422);
  if (!quote.pdf_sha256) return json({ error: "pdf_missing" }, 500);

  const doc = await loadDocument(deps, quote);
  if (!doc || !doc.profile) return json({ error: "load_failed" }, 500);
  const profile = doc.profile;

  const now = deps.now();
  const signaturePath = signature?.method === "drawn" ? `${quote.org_id}/signatures/${quote.id}.png` : null;
  const w = deps.admin.schema("werkbank");

  // The acceptance row comes first: its unique quote_id is the gate against a second decision.
  const { error: insErr } = await w.from("quote_acceptances").insert({
    org_id: quote.org_id,
    quote_id: quote.id,
    decision,
    comment,
    signer_name: signerName,
    method: signature?.method ?? null,
    typed_name: signature?.method === "typed" ? signature.typedName : null,
    signature_image_path: signaturePath,
    decided_at: now.toISOString(),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: req.headers.get("user-agent") || null,
    consent_text: decision === "accepted" ? quoteConsentText(quote.quote_no) : null,
    document_sha256: quote.pdf_sha256,
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      const { data: prior } = await w.from("quote_acceptances").select("decision")
        .eq("org_id", quote.org_id).eq("quote_id", quote.id).maybeSingle();
      const priorDecision = (prior as { decision?: string } | null)?.decision;
      return json({ error: "decided", ...(priorDecision ? { decision: priorDecision } : {}) }, 410);
    }
    console.error("werkbank-quotes: recording the decision failed", { quoteId: quote.id, error: insErr });
    return json({ error: "insert_failed" }, 500);
  }

  // Until the status update lands, a failure undoes the decision so the customer can try again.
  const uploaded: string[] = [];
  const rollback = async () => {
    const { error: delErr } = await w.from("quote_acceptances").delete()
      .eq("org_id", quote.org_id).eq("quote_id", quote.id);
    if (delErr) console.error("werkbank-quotes: could not undo a decision", { quoteId: quote.id, error: delErr });
    if (uploaded.length > 0) {
      const { error: rmErr } = await deps.admin.storage.from(DOCUMENTS_BUCKET).remove(uploaded);
      if (rmErr) console.warn("werkbank-quotes: could not remove unused uploads", { quoteId: quote.id, error: rmErr });
    }
  };

  let acceptedBytes: Uint8Array | null = null;
  let acceptedPath: string | null = null;
  if (decision === "accepted" && signature) {
    try {
      const documents = deps.admin.storage.from(DOCUMENTS_BUCKET);
      if (signature.method === "drawn" && signaturePath) {
        const { error } = await documents.upload(signaturePath, signature.png, { contentType: "image/png", upsert: false });
        if (error) throw new Error(`signature upload: ${JSON.stringify(error)}`);
        uploaded.push(signaturePath);
      }
      acceptedBytes = await render(buildQuotePdfData({
        quote,
        items: doc.items,
        totals: doc.totals,
        customer: doc.customer,
        property: doc.property,
        profile,
        logoDataUrl: await logoDataUrl(deps, profile.logo_path),
        // The sent document as it was printed, plus the signature block.
        date: formatDateDe(sentDateKey(quote)),
        acceptance: {
          name: signerName,
          decidedAt: berlinDateKey(now),
          signaturePngDataUrl: signature.method === "drawn"
            ? `data:image/png;base64,${encodeBase64(signature.png)}`
            : undefined,
          typedName: signature.method === "typed" ? signature.typedName : undefined,
        },
      }));
      const sha = await sha256Hex(acceptedBytes);
      const path = `${quote.org_id}/quotes/${quote.id}-accepted-${sha.slice(0, 16)}.pdf`;
      const { error } = await documents.upload(path, acceptedBytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error(`accepted pdf upload: ${JSON.stringify(error)}`);
      uploaded.push(path);
      acceptedPath = path;
    } catch (e) {
      console.error("werkbank-quotes: preparing the accepted PDF failed", { quoteId: quote.id, error: String(e) });
      await rollback();
      return json({ error: "render_failed" }, 500);
    }
  }

  const patch = decision === "accepted" ? { status: "accepted", accepted_pdf_path: acceptedPath } : { status: "rejected" };
  const { data: stamped, error: updErr } = await w.from("quotes").update(patch)
    .eq("id", quote.id).eq("org_id", quote.org_id).eq("status", "sent")
    .select("id").maybeSingle();
  if (updErr || !stamped) {
    if (updErr) console.error("werkbank-quotes: setting the decision failed", { quoteId: quote.id, error: updErr });
    await rollback();
    if (updErr) return json({ error: "update_failed" }, 500);
    // Superseded, revoked or decided in the meantime: answer with the state the quote is in now.
    const { data: reread } = await w.from("quotes").select("*").eq("id", quote.id).eq("org_id", quote.org_id).maybeSingle();
    const current = (reread ?? null) as unknown as QuoteRow | null;
    const state = linkState(current, berlinDateKey(now));
    if (state.open) return json({ error: "update_failed" }, 500);
    return closedResponse(deps, current, state);
  }

  // The decision is final from here: side effects are logged, never an error response.
  const decided: DecisionFacts = { decision, signerName, comment, decidedAt: now };
  const officeIds = await officeUserIds(deps, quote.org_id).catch((e) => {
    console.error("werkbank-quotes: reading the office members failed", { quoteId: quote.id, error: String(e) });
    return [] as string[];
  });
  await notifyOffice(deps, quote, decided, officeIds).catch((e) =>
    console.error("werkbank-quotes: notifying the office failed", { quoteId: quote.id, error: String(e) })
  );
  await emailOffice(deps, quote, doc.customer, decided, officeIds).catch((e) =>
    console.error("werkbank-quotes: emailing the office failed", { quoteId: quote.id, error: String(e) })
  );
  await emailConfirmation(deps, quote, profile, decided, acceptedBytes).catch((e) =>
    console.error("werkbank-quotes: confirmation email failed", { quoteId: quote.id, error: String(e) })
  );

  const pdfUrl = acceptedPath ? await signedUrl(deps, DOCUMENTS_BUCKET, acceptedPath).catch(() => null) : null;
  return json({ ok: true, ...(pdfUrl ? { pdf_url: pdfUrl } : {}) });
}

interface DecisionFacts {
  decision: Decision;
  signerName: string;
  comment: string | null;
  decidedAt: Date;
}

/** Every admin and producer membership of the org, de-duplicated by user. */
async function officeUserIds(deps: Deps, orgId: string): Promise<string[]> {
  const { data, error } = await deps.admin.from("org_memberships").select("user_id")
    .eq("org_id", orgId).in("role", ["admin", "producer"]);
  if (error) throw new Error(`memberships: ${JSON.stringify(error)}`);
  return [...new Set(((data ?? []) as unknown as Array<{ user_id: string }>).map((m) => m.user_id))];
}

async function notifyOffice(deps: Deps, quote: QuoteRow, d: DecisionFacts, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const accepted = d.decision === "accepted";
  const rows = userIds.map((uid) => ({
    org_id: quote.org_id,
    user_id: uid,
    type: accepted ? "quote_accepted" : "quote_rejected",
    title: accepted ? "Angebot angenommen" : "Angebot abgelehnt",
    message: `${d.signerName} hat das Angebot ${quote.quote_no} ${accepted ? "angenommen" : "abgelehnt"}.`,
    related_entity_type: "werkbank_quote",
    related_entity_id: quote.id,
  }));
  const { error } = await deps.admin.from("notifications").insert(rows);
  if (error) throw new Error(`notifications: ${JSON.stringify(error)}`);
}

async function emailOffice(
  deps: Deps,
  quote: QuoteRow,
  customer: CustomerRow,
  d: DecisionFacts,
  userIds: string[],
): Promise<void> {
  const base = brandAppUrl(brandForKind(WERKBANK_ORG_KIND.kind), appUrl(deps.env));
  for (const uid of userIds) {
    const { data } = await deps.admin.auth.admin.getUserById(uid);
    const email = (data as { user?: { email?: string | null } | null } | null)?.user?.email;
    if (!email) continue;
    const result = await deps.sendEmail({
      template_name: "quote-decided",
      recipient_email: email,
      org_id: quote.org_id,
      locale: "de",
      templateData: {
        quote_no: quote.quote_no,
        customer_name: customerName(customer),
        signer_name: d.signerName,
        decision: d.decision,
        comment: d.comment ?? "",
        link: `${base}/quotes/${quote.id}`,
      },
      idempotency_key: `quote-decided-${quote.id}-${uid}`,
    });
    if (!emailWasSent(result)) console.warn("werkbank-quotes: office email not delivered", { quoteId: quote.id, uid });
  }
}

async function emailConfirmation(
  deps: Deps,
  quote: QuoteRow,
  profile: ProfileRow,
  d: DecisionFacts,
  acceptedBytes: Uint8Array | null,
): Promise<void> {
  // The signer's address is the recipient of the sent email.
  const recipient = quote.sent_to?.[0];
  if (!recipient) return;
  const replyTo = profile.email?.trim();
  const result = await deps.sendEmail({
    template_name: "quote-decision-confirmation",
    recipient_email: recipient,
    org_id: quote.org_id,
    locale: "de",
    ...(replyTo ? { reply_to: replyTo } : {}),
    templateData: {
      quote_no: quote.quote_no,
      company_name: profile.company_name,
      signer_name: d.signerName,
      decision: d.decision,
      decided_at: formatDateDe(berlinDateKey(d.decidedAt)),
    },
    ...(acceptedBytes
      ? {
        attachments: [{
          filename: `Angebot-${quote.quote_no}-angenommen.pdf`,
          content_base64: encodeBase64(acceptedBytes),
        }],
      }
      : {}),
    idempotency_key: `quote-decision-confirmation-${quote.id}`,
  });
  if (!emailWasSent(result)) console.warn("werkbank-quotes: confirmation email not delivered", { quoteId: quote.id });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
