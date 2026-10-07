// werkbank-quotes: the quote document actions of the Werkbank module (spec R6).
//
// Internal actions (admin or producer of the org, handwerk orgs only):
//   preview      { org_id, quote_id }                      -> { pdf_base64 }       (persists nothing)
//   send         { org_id, quote_id, to[], cc[], message } -> { ok, email_sent }
//   resend       { org_id, quote_id, to[], cc[], message } -> { ok, email_sent }   (sent quotes only)
//   download-url { org_id, quote_id, kind }                -> { url }              (600 s)
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

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
