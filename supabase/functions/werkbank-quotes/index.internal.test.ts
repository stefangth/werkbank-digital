// Internal actions of werkbank-quotes (R6): preview, send, resend, download-url.
import { assert, assertEquals, assertExists, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { makeFakeDeps, makeRequest, type FakeDepsOptions, type TableSeed } from "../_shared/testing.ts";
import type { EmailMessage } from "../_shared/deps.ts";
import { categoryForTemplate } from "../_shared/notificationCategories.ts";
import type { QuotePdfData } from "../_shared/werkbank/pdf/quoteData.ts";
import { sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import { handle } from "./index.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const QUOTE = "33333333-3333-4333-8333-333333333333";
const APP = "https://werkbank.test";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
// 22:30 UTC on Oct 7 is already Oct 8 in Berlin (CEST): the PDF must print the Berlin date.
const NOW = new Date("2026-10-07T22:30:00.000Z");

const profile = {
  org_id: ORG, company_name: "Muster Sanitär", legal_form: "GmbH", street: "Werkstr. 2", postal_code: "80331",
  city: "München", country_code: "DE", email: "buero@muster.de", tax_number: "143/123/45678", vat_id: null,
  logo_path: null,
};
const customer = {
  id: "c-1", org_id: ORG, kind: "private", first_name: "Anna", last_name: "Muster", company_name: null,
  street: "Hauptstr. 1", postal_code: "80331", city: "München",
};
const totals = {
  quote_id: QUOTE, order_id: null, invoice_id: null, net_total: 100, discount_total: 0, vat_total: 19, gross_total: 119,
  labour_total: 50, vat_breakdown: [{ rate: 19, net: 100, discounted_net: 100, vat: 19 }],
};
const items = [
  { id: "i-1", sort_order: 1, kind: "title", name: "Bad" },
  { id: "i-2", sort_order: 2, kind: "item", name: "Fliesen", quantity: 2, unit_code: "MTK", material_price: 30, labour_price: 20, line_net: 100, vat_rate: 19 },
];

function quoteRow(over: Record<string, unknown> = {}) {
  return {
    id: QUOTE, org_id: ORG, quote_no: "A-0042", version: 1, customer_id: "c-1", property_id: null, contact_id: null,
    subject: "Badsanierung", intro_text: "Vielen Dank.", closing_text: "Gruß", payment_terms_text: "14 Tage",
    discount_percent: 0, valid_until: "2026-11-06", status: "draft", sent_at: null, sent_to: null, pdf_path: null,
    pdf_sha256: null, accepted_pdf_path: null, access_token_hash: null, link_revoked_at: null,
    updated_at: "2026-10-07T20:00:00.000Z",
    ...over,
  };
}

interface Setup {
  quote?: Record<string, unknown> | null;
  /** What the guarded stamp update returns; null models zero matched rows. */
  stamp?: Record<string, unknown> | null;
  items?: unknown[];
  orgKind?: string;
  role?: string | null;
  profile?: Record<string, unknown>;
  opts?: FakeDepsOptions;
}

function setup(s: Setup = {}) {
  const tables: Record<string, TableSeed> = {
    org_memberships: s.role === null ? [] : [{ when: { org_id: ORG }, data: { role: s.role ?? "producer" } }],
    organizations: [{ when: { id: ORG }, data: { org_kind: s.orgKind ?? "handwerk" } }],
    // The quote is only found under its own org: a quote id paired with another org_id misses.
    "werkbank.quotes": [
      { when: { __write: true }, data: s.stamp === undefined ? { id: QUOTE } : s.stamp },
      { when: { id: QUOTE, org_id: ORG }, data: s.quote === undefined ? quoteRow() : s.quote },
    ],
    "werkbank.document_items": { data: s.items ?? items, error: null },
    "werkbank.document_totals": { data: totals, error: null },
    "werkbank.customers": { data: customer, error: null },
    "werkbank.company_profiles": { data: s.profile ?? profile, error: null },
  };
  const fake = makeFakeDeps({ authUser: { id: "u-1" }, envVars: { APP_URL: APP }, now: NOW, tables, ...s.opts });
  // Record the email in the same call log as storage and DB writes, so tests can check the order.
  const sendEmail = fake.deps.sendEmail;
  const emails: EmailMessage[] = [];
  fake.deps.sendEmail = (msg) => {
    emails.push(msg);
    fake.calls.push({ table: "email", method: "send", args: [msg] });
    return sendEmail(msg);
  };
  const rendered: QuotePdfData[] = [];
  const render = (data: QuotePdfData) => {
    rendered.push(data);
    return Promise.resolve(PDF);
  };
  return { ...fake, emails, rendered, render };
}

const request = (body: Record<string, unknown>) =>
  makeRequest({ headers: { Authorization: "Bearer user-jwt" }, body });

const sendBody = (over: Record<string, unknown> = {}) => ({
  action: "send", org_id: ORG, quote_id: QUOTE, to: ["kunde@example.com"], cc: [], message: "Anbei unser Angebot.",
  ...over,
});

function writes(calls: { table: string; method: string }[]) {
  return calls.filter((c) =>
    c.method === "update" || c.method === "insert" || c.method === "upsert" || c.method === "delete" ||
    c.method === "upload" || c.method === "remove"
  );
}

Deno.test("a producer of another org is forbidden", async () => {
  const t = setup();
  const res = await handle(request({ action: "preview", org_id: OTHER_ORG, quote_id: QUOTE }), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
  assertEquals(t.rendered.length, 0);
});

Deno.test("a non-handwerk org gets not_handwerk", async () => {
  const t = setup({ orgKind: "production" });
  const res = await handle(request({ action: "preview", org_id: ORG, quote_id: QUOTE }), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "not_handwerk" });
});

Deno.test("an unknown quote is not_found", async () => {
  const t = setup({ quote: null });
  const res = await handle(request({ action: "preview", org_id: ORG, quote_id: QUOTE }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("preview returns the watermarked PDF as base64 and writes nothing", async () => {
  const t = setup();
  const res = await handle(request({ action: "preview", org_id: ORG, quote_id: QUOTE }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { pdf_base64: encodeBase64(PDF) });
  assertEquals(t.rendered.length, 1);
  assertEquals(t.rendered[0].watermark, "Entwurf");
  assertEquals(t.rendered[0].date, "08.10.2026");
  assertEquals(writes(t.calls), []);
  assertEquals(t.emails, []);
});

Deno.test("send without items returns 422 no_items and writes nothing", async () => {
  const t = setup({ items: [items[0]] });
  const res = await handle(request(sendBody()), t.deps, t.render);
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "preflight_failed", blockers: ["no_items"] });
  assertEquals(writes(t.calls), []);
  assertEquals(t.rendered.length, 0);
});

Deno.test("send on a quote that is not a draft is invalid_state", async () => {
  const t = setup({ quote: quoteRow({ status: "sent", pdf_path: `${ORG}/quotes/${QUOTE}.pdf` }) });
  const res = await handle(request(sendBody()), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "invalid_state" });
  assertEquals(writes(t.calls), []);
});

Deno.test("send uploads, stamps the quote in one update, then emails the customer", async () => {
  const t = setup();
  const res = await handle(request(sendBody()), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, email_sent: true });

  const sequence = writes(t.calls).map((c) => `${c.table}:${c.method}`);
  const emailIndex = t.calls.findIndex((c) => c.table === "email");
  assertEquals(sequence, ["storage:werkbank-documents:upload", "werkbank.quotes:update"]);
  const updateIndex = t.calls.findIndex((c) => c.table === "werkbank.quotes" && c.method === "update");
  assert(emailIndex > updateIndex, "the email goes out after the quote is stamped");

  const path = `${ORG}/quotes/${QUOTE}-${(await sha256Hex(PDF)).slice(0, 16)}.pdf`;
  const upload = t.calls.find((c) => c.method === "upload");
  assertExists(upload);
  assertEquals(upload.args[0], path, "content-addressed path");
  assertEquals(upload.args[1], PDF);
  assertEquals((upload.args[2] as { upsert?: boolean }).upsert, false, "never overwrites a stored PDF");
  assertEquals(t.rendered[0].watermark, undefined);
  assertEquals(t.rendered[0].date, "08.10.2026");

  const update = t.calls.find((c) => c.table === "werkbank.quotes" && c.method === "update");
  assertExists(update);
  const patch = update.args[0] as Record<string, unknown>;
  assertEquals(Object.keys(patch).sort(), ["access_token_hash", "pdf_path", "pdf_sha256", "sent_at", "sent_to", "status"]);
  assertEquals(patch.status, "sent");
  assertEquals(patch.sent_at, NOW.toISOString());
  assertEquals(patch.sent_to, ["kunde@example.com"]);
  assertEquals(patch.pdf_path, path);
  assertEquals(patch.pdf_sha256, await sha256Hex(PDF));
  assert(/^[0-9a-f]{64}$/.test(String(patch.pdf_sha256)));
  // The guard against a concurrent send or edit: only the loaded, unchanged draft is stamped.
  assert(t.calls.some((c) => c.table === "werkbank.quotes" && c.method === "eq" && c.args[0] === "status" && c.args[1] === "draft"));
  assert(t.calls.some((c) => c.table === "werkbank.quotes" && c.method === "eq" && c.args[0] === "updated_at" && c.args[1] === "2026-10-07T20:00:00.000Z"));
  assertEquals(t.calls.filter((c) => c.method === "remove").length, 0);

  assertEquals(t.emails.length, 1);
  const email = t.emails[0];
  assertEquals(email.template_name, "quote-sent");
  assertEquals(email.recipient_email, "kunde@example.com");
  assertEquals(email.org_id, ORG);
  assertEquals(email.reply_to, "buero@muster.de");
  assertEquals(email.locale, "de");
  assertEquals(email.attachments?.length, 1);
  assertEquals(email.attachments?.[0].content_base64, encodeBase64(PDF));
  const link = String(email.templateData?.link);
  const prefix = `${APP}/quote/`;
  assert(link.startsWith(prefix), link);
  const token = link.slice(prefix.length);
  assert(/^[0-9a-f]{64}$/.test(token), "the link carries 32 random bytes as hex");
  assertEquals(await sha256Hex(token), patch.access_token_hash);
  assertEquals(email.templateData?.quote_no, "A-0042");
  assertEquals(email.templateData?.message, "Anbei unser Angebot.");
});

Deno.test("send emails every to and cc address and records them", async () => {
  const t = setup();
  const res = await handle(request(sendBody({ to: [" kunde@example.com "], cc: ["hv@example.com", "KUNDE@example.com"] })), t.deps, t.render);
  assertEquals(res.status, 200);
  const update = t.calls.find((c) => c.table === "werkbank.quotes" && c.method === "update");
  assertEquals((update?.args[0] as Record<string, unknown>).sent_to, ["kunde@example.com", "hv@example.com"]);
  assertEquals(t.emails.map((e) => e.recipient_email), ["kunde@example.com", "hv@example.com"]);
});

Deno.test("send rejects a malformed recipient", async () => {
  const t = setup();
  const res = await handle(request(sendBody({ to: ["not-an-address"] })), t.deps, t.render);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid_recipient" });
  assertEquals(writes(t.calls), []);
});

Deno.test("a failed email keeps the quote sent and says so", async () => {
  const t = setup({ opts: { emailResult: { data: null, error: { message: "resend down" } } } });
  const res = await handle(request(sendBody()), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, email_sent: false });
  const update = t.calls.find((c) => c.table === "werkbank.quotes" && c.method === "update");
  assertEquals((update?.args[0] as Record<string, unknown>).status, "sent");
  assertEquals(writes(t.calls).filter((c) => c.method !== "upload").length, 1, "no rollback write");
});

Deno.test("resend on a sent quote stores a new token hash and keeps the stored PDF", async () => {
  const path = `${ORG}/quotes/${QUOTE}.pdf`;
  const t = setup({
    quote: quoteRow({ status: "sent", sent_at: "2026-10-01T08:00:00Z", pdf_path: path, pdf_sha256: "f".repeat(64), access_token_hash: "old" }),
    opts: { storageDownloadResult: { data: new Blob([PDF]), error: null } },
  });
  const res = await handle(request({ ...sendBody(), action: "resend" }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, email_sent: true });
  assertEquals(t.rendered.length, 0, "no new render");
  assertEquals(t.calls.filter((c) => c.method === "upload").length, 0, "no new upload");
  const download = t.calls.find((c) => c.method === "download");
  assertEquals(download?.table, "storage:werkbank-documents");
  assertEquals(download?.args[0], path);

  const update = t.calls.find((c) => c.table === "werkbank.quotes" && c.method === "update");
  assertExists(update);
  const patch = update.args[0] as Record<string, unknown>;
  assertNotEquals(patch.access_token_hash, "old");
  assertEquals("pdf_path" in patch, false);
  assertEquals("pdf_sha256" in patch, false);
  assertEquals(patch.link_revoked_at, null, "a fresh link is not revoked");
  assert(t.calls.some((c) => c.table === "werkbank.quotes" && c.method === "eq" && c.args[0] === "status" && c.args[1] === "sent"));

  const link = String(t.emails[0].templateData?.link);
  assertEquals(await sha256Hex(link.slice(`${APP}/quote/`.length)), patch.access_token_hash);
  assertEquals(t.emails[0].attachments?.[0].content_base64, encodeBase64(PDF));
});

Deno.test("resend on a draft is invalid_state", async () => {
  const t = setup();
  const res = await handle(request({ ...sendBody(), action: "resend" }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "invalid_state" });
  assertEquals(writes(t.calls), []);
  assertEquals(t.emails, []);
});

Deno.test("download-url signs the sent PDF for 600 seconds", async () => {
  const path = `${ORG}/quotes/${QUOTE}.pdf`;
  const t = setup({ quote: quoteRow({ status: "sent", pdf_path: path }) });
  const res = await handle(request({ action: "download-url", org_id: ORG, quote_id: QUOTE, kind: "sent" }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { url: `https://signed.test/werkbank-documents/${path}` });
  const sign = t.calls.find((c) => c.method === "createSignedUrl");
  assertEquals(sign?.table, "storage:werkbank-documents");
  assertEquals(sign?.args, [path, 600]);
});

Deno.test("download-url for an accepted PDF that does not exist is not_found", async () => {
  const t = setup({ quote: quoteRow({ status: "sent", pdf_path: `${ORG}/quotes/${QUOTE}.pdf` }) });
  const res = await handle(request({ action: "download-url", org_id: ORG, quote_id: QUOTE, kind: "accepted" }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("quote emails are never preference gated", () => {
  for (const name of ["quote-sent", "quote-decided", "quote-decision-confirmation"]) {
    assertEquals(categoryForTemplate(name), null, name);
  }
});

Deno.test("the logo is read from werkbank-assets and handed to the PDF as a data URL", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const t = setup({
    profile: { ...profile, logo_path: `${ORG}/logo.png` },
    opts: { storageDownloadResult: { data: new Blob([png]), error: null } },
  });
  const res = await handle(request({ action: "preview", org_id: ORG, quote_id: QUOTE }), t.deps, t.render);
  assertEquals(res.status, 200);
  const download = t.calls.find((c) => c.method === "download");
  assertEquals(download?.table, "storage:werkbank-assets");
  assertEquals(download?.args[0], `${ORG}/logo.png`);
  assertEquals(t.rendered[0].seller.logoDataUrl, `data:image/png;base64,${encodeBase64(png)}`);
});

Deno.test("a logo that cannot be read leaves the PDF without one", async () => {
  const t = setup({
    profile: { ...profile, logo_path: `${ORG}/logo.png` },
    opts: { storageDownloadResult: { data: null, error: { message: "not found" } } },
  });
  const res = await handle(request({ action: "preview", org_id: ORG, quote_id: QUOTE }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(t.rendered[0].seller.logoDataUrl, undefined);
});

Deno.test("a losing send (guarded update matches no row) removes its upload and sends no email", async () => {
  // Zero rows: a concurrent send won, or the draft was edited after it was loaded.
  const t = setup({ stamp: null });
  const res = await handle(request(sendBody()), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "invalid_state" });
  const upload = t.calls.find((c) => c.method === "upload");
  const remove = t.calls.find((c) => c.method === "remove");
  assertExists(upload);
  assertExists(remove);
  assertEquals(remove.table, "storage:werkbank-documents");
  assertEquals(remove.args[0], [upload.args[0]]);
  assertEquals(t.emails, []);
});

Deno.test("an upload that finds the same bytes already stored is invalid_state", async () => {
  const t = setup({ opts: { storageUploadResult: { data: null, error: { statusCode: "409", message: "The resource already exists" } } } });
  const res = await handle(request(sendBody()), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "invalid_state" });
  assertEquals(t.calls.filter((c) => c.table === "werkbank.quotes" && c.method === "update").length, 0);
  assertEquals(t.emails, []);
});

Deno.test("another org's quote id under this org_id is not_found", async () => {
  const t = setup();
  const res = await handle(
    request({ action: "preview", org_id: ORG, quote_id: "44444444-4444-4444-8444-444444444444" }),
    t.deps,
    t.render,
  );
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
  assert(t.calls.some((c) => c.table === "werkbank.quotes" && c.method === "eq" && c.args[0] === "org_id" && c.args[1] === ORG));
  assertEquals(t.rendered.length, 0);
});

Deno.test("a revised quote (version 2) is sent as A-0042-2: PDF, filename and email", async () => {
  const t = setup({ quote: quoteRow({ version: 2 }) });
  const res = await handle(request(sendBody()), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(t.rendered[0].number, "A-0042-2");
  assertEquals(t.emails[0].attachments?.[0].filename, "Angebot-A-0042-2.pdf");
  assertEquals(t.emails[0].templateData?.quote_no, "A-0042-2");
});

Deno.test("a resend of a revised quote names the version too", async () => {
  const t = setup({
    quote: quoteRow({ version: 3, status: "sent", sent_at: "2026-10-01T08:00:00Z", pdf_path: `${ORG}/quotes/${QUOTE}.pdf`, pdf_sha256: "f".repeat(64) }),
    opts: { storageDownloadResult: { data: new Blob([PDF]), error: null } },
  });
  const res = await handle(request({ ...sendBody(), action: "resend" }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(t.emails[0].attachments?.[0].filename, "Angebot-A-0042-3.pdf");
  assertEquals(t.emails[0].templateData?.quote_no, "A-0042-3");
});

for (const status of ["rejected", "superseded", "accepted"]) {
  Deno.test(`download-url signs the sent PDF of a ${status} quote`, async () => {
    const path = `${ORG}/quotes/${QUOTE}.pdf`;
    const t = setup({ quote: quoteRow({ status, pdf_path: path }) });
    const res = await handle(request({ action: "download-url", org_id: ORG, quote_id: QUOTE, kind: "sent" }), t.deps, t.render);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { url: `https://signed.test/werkbank-documents/${path}` });
  });
}
