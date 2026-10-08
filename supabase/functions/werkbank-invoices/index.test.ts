// werkbank-invoices (R5): preview, issue (incl. resume) and download-url.
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  createFakeClient,
  type FakeDepsOptions,
  makeFakeDeps,
  makeRequest,
  type RecordedCall,
  type TableSeed,
} from "../_shared/testing.ts";
import { asTypedClient } from "../_shared/testing.ts";
import type { InvoiceData } from "../_shared/werkbank/einvoice/invoiceData.ts";
import { sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import { handle } from "./index.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const INV = "33333333-3333-4333-8333-333333333333";
const ORIG = "44444444-4444-4444-8444-444444444444";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const EINVOICE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x41, 0x33]);
const PATH = `${ORG}/invoices/${INV}.pdf`;

const profile = {
  org_id: ORG, company_name: "Muster Sanitär", legal_form: "GmbH", street: "Werkstr. 2", postal_code: "80331",
  city: "München", country_code: "DE", phone: null, email: "buero@muster.de", website: null,
  tax_number: "143/123/45678", vat_id: null, register_court: null, register_number: null,
  iban: "DE02120300000000202051", bic: null, bank_name: null, logo_path: null, quote_intro: null,
  quote_closing: null, payment_terms_text: null, quote_validity_days: 30, invoice_intro: null,
  invoice_closing: null, payment_due_days: 14, created_at: "", updated_at: "",
};
const { org_id: _o, created_at: _c, updated_at: _u, ...sellerSnapshot } = profile;
const customer = {
  id: "c-1", org_id: ORG, kind: "private", first_name: "Anna", last_name: "Muster", company_name: null,
  street: "Hauptstr. 1", postal_code: "80331", city: "München", country_code: "DE", customer_no: "K-10001",
  vat_id: null, invoice_email: "re@example.com",
};
const buyerSnapshot = {
  name: "Muster, Anna", street: "Hauptstr. 1", postal_code: "80331", city: "München", country_code: "DE",
  customer_no: "K-10001", vat_id: null, invoice_email: "re@example.com", is_private: true, billing_override: false,
  property: null,
};
const totals = {
  quote_id: null, order_id: null, invoice_id: INV, net_total: 100, discount_total: 0, vat_total: 19, gross_total: 119,
  labour_total: 40, vat_breakdown: [{ rate: 19, net: 100, discounted_net: 100, vat: 19 }],
};
const items = [
  { id: "i-1", sort_order: 1, kind: "title", name: "Bad" },
  {
    id: "i-2", sort_order: 2, kind: "item", name: "Fliesen", quantity: 2, unit_code: "MTK", material_price: 30,
    labour_price: 20, line_net: 100, vat_rate: 19,
  },
];

function invoiceRow(over: Record<string, unknown> = {}) {
  return {
    id: INV, org_id: ORG, type: "invoice", invoice_no: null, order_id: null, cancels_invoice_id: null,
    customer_id: "c-1", property_id: null, contact_id: null, subject: "Badsanierung", location_note: null,
    discount_percent: 0, intro_text: "Vielen Dank.", closing_text: "Gruß", payment_terms_text: "14 Tage",
    service_date_from: "2026-10-01", service_date_to: null, payment_due_days: 14, issue_date: null, due_date: null,
    status: "draft", issued_at: null, seller_snapshot: null, buyer_snapshot: null, pdf_path: null, pdf_sha256: null,
    sent_at: null, sent_to: null, created_at: "", updated_at: "",
    ...over,
  };
}

const issuedRow = (over: Record<string, unknown> = {}) =>
  invoiceRow({
    status: "issued", invoice_no: "RE-0007", issue_date: "2026-10-08", due_date: "2026-10-22",
    issued_at: "2026-10-08T08:00:00Z", seller_snapshot: sellerSnapshot, buyer_snapshot: buyerSnapshot, ...over,
  });

interface Setup {
  invoice?: Record<string, unknown> | null;
  original?: Record<string, unknown> | null;
  /** What the guarded stamp update returns; null models zero matched rows. */
  stamp?: Record<string, unknown> | null;
  orgKind?: string;
  rpc?: { data?: unknown; error?: unknown };
  opts?: FakeDepsOptions;
}

function setup(s: Setup = {}) {
  const tables: Record<string, TableSeed> = {
    org_memberships: [{ when: { org_id: ORG }, data: { role: "producer" } }],
    organizations: [{ when: { id: ORG }, data: { org_kind: s.orgKind ?? "handwerk" } }],
    "werkbank.invoices": [
      { when: { __write: true }, data: s.stamp === undefined ? { id: INV } : s.stamp },
      { when: { id: INV, org_id: ORG }, data: s.invoice === undefined ? invoiceRow() : s.invoice },
      { when: { id: ORIG, org_id: ORG }, data: s.original ?? null },
    ],
    "werkbank.document_items": { data: items, error: null },
    "werkbank.document_totals": { data: totals, error: null },
    "werkbank.customers": { data: customer, error: null },
    "werkbank.company_profiles": { data: profile, error: null },
  };
  const fake = makeFakeDeps({ authUser: { id: "u-1" }, tables, ...s.opts });
  // The caller's JWT client is a separate fake, so a test can tell which client ran the RPC.
  const user = createFakeClient({
    authUser: { id: "u-1" },
    rpcs: { "werkbank.finalize_invoice": s.rpc ?? { data: issuedRow(), error: null } },
  });
  const userAuthHeaders: string[] = [];
  fake.deps.userClient = (authHeader: string) => {
    userAuthHeaders.push(authHeader);
    return asTypedClient(user.client);
  };
  const pdfRendered: InvoiceData[] = [];
  const einvoiceRendered: InvoiceData[] = [];
  const render = {
    pdf: (data: InvoiceData) => {
      pdfRendered.push(data);
      return Promise.resolve(PDF);
    },
    einvoice: (data: InvoiceData) => {
      einvoiceRendered.push(data);
      return Promise.resolve(EINVOICE);
    },
  };
  return { ...fake, userCalls: user.calls, userAuthHeaders, pdfRendered, einvoiceRendered, render };
}

const request = (body: Record<string, unknown>) => makeRequest({ headers: { Authorization: "Bearer user-jwt" }, body });

function writes(calls: RecordedCall[]) {
  return calls.filter((c) =>
    ["update", "insert", "upsert", "delete", "upload", "remove", "rpc"].includes(c.method) &&
    !(c.method === "rpc" && c.table !== "rpc:werkbank.finalize_invoice")
  );
}

// ── gates ────────────────────────────────────────────────────────────────────

Deno.test("a producer of another org is forbidden", async () => {
  const t = setup();
  const res = await handle(request({ action: "preview", org_id: OTHER_ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
  assertEquals(t.pdfRendered.length, 0);
});

Deno.test("a non-handwerk org gets not_handwerk", async () => {
  const t = setup({ orgKind: "production" });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "not_handwerk" });
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

Deno.test("an unknown invoice is not_found", async () => {
  const t = setup({ invoice: null });
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("an unknown action and a missing id are bad requests", async () => {
  const t = setup();
  assertEquals((await handle(request({ action: "frobnicate", org_id: ORG, invoice_id: INV }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ action: "preview", org_id: ORG }), t.deps, t.render)).status, 400);
});

// ── preview ──────────────────────────────────────────────────────────────────

Deno.test("preview returns the watermarked draft PDF and records no rpc, update or storage call", async () => {
  const t = setup();
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { pdf_base64: encodeBase64(PDF) });
  assertEquals(t.pdfRendered.length, 1);
  assertEquals(t.einvoiceRendered.length, 0, "no XML for a preview");
  const data = t.pdfRendered[0];
  assertEquals(data.watermark, "Entwurf");
  // Seller and buyer come from the live rows, in the shape finalize_invoice snapshots.
  assertEquals(data.seller, sellerSnapshot);
  assertEquals(data.buyer, buyerSnapshot);
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
  assertEquals(t.calls.filter((c) => c.table.startsWith("storage:")), []);
});

Deno.test("preview of a cancellation draft addresses the original's buyer and names the original", async () => {
  const otherBuyer = { ...buyerSnapshot, name: "Alt, Anna" };
  const t = setup({
    invoice: invoiceRow({ type: "cancellation", cancels_invoice_id: ORIG }),
    original: issuedRow({ id: ORIG, invoice_no: "RE-0003", issue_date: "2026-09-30", buyer_snapshot: otherBuyer }),
  });
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  const data = t.pdfRendered[0];
  assertEquals(data.type, "cancellation");
  assertEquals(data.buyer.name, "Alt, Anna");
  assertEquals(data.precedingInvoice, { number: "RE-0003", issueDate: "2026-09-30" });
});

Deno.test("preview of an issued invoice is invalid_state", async () => {
  const t = setup({ invoice: issuedRow({ pdf_path: PATH }) });
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "invalid_state" });
  assertEquals(t.pdfRendered.length, 0);
});

// ── issue ────────────────────────────────────────────────────────────────────

Deno.test("issue finalizes through the user client, uploads, then stamps through the admin client", async () => {
  const t = setup();
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, invoice_no: "RE-0007" });

  // finalize_invoice runs with the caller's JWT, never as the service role.
  const rpc = t.userCalls.find((c) => c.table === "rpc:werkbank.finalize_invoice");
  assertExists(rpc);
  assertEquals(rpc.args[0], { p_invoice: INV });
  assert(t.userAuthHeaders.every((h) => h === "Bearer user-jwt"));
  assertEquals(t.calls.filter((c) => c.table === "rpc:werkbank.finalize_invoice"), []);

  // The e-invoice is rendered from the row finalize returned (snapshots, number), no watermark.
  assertEquals(t.einvoiceRendered.length, 1);
  assertEquals(t.einvoiceRendered[0].number, "RE-0007");
  assertEquals(t.einvoiceRendered[0].watermark, undefined);

  const sequence = writes(t.calls).map((c) => `${c.table}:${c.method}`);
  assertEquals(sequence, ["storage:werkbank-documents:upload", "werkbank.invoices:update"]);
  const upload = t.calls.find((c) => c.method === "upload");
  assertExists(upload);
  assertEquals(upload.args[0], PATH);
  assertEquals(upload.args[1], EINVOICE);
  assertEquals(upload.args[2], { contentType: "application/pdf", upsert: false });

  const update = t.calls.find((c) => c.table === "werkbank.invoices" && c.method === "update");
  assertExists(update);
  assertEquals(update.args[0], { pdf_path: PATH, pdf_sha256: await sha256Hex(EINVOICE) });
  // Stamped once: only while pdf_path is still null.
  assert(t.calls.some((c) => c.table === "werkbank.invoices" && c.method === "is" && c.args[0] === "pdf_path"));
});

Deno.test("issue maps invoice_not_ready to 422 with the blockers and stores nothing", async () => {
  const t = setup({ rpc: { data: null, error: { code: "22023", message: "invoice_not_ready", details: "no_items" } } });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "preflight_failed", blockers: ["no_items"] });
  assertEquals(writes(t.calls), []);
  assertEquals(t.einvoiceRendered.length, 0);
});

Deno.test("issue passes every blocker of the detail through", async () => {
  const t = setup({
    rpc: { data: null, error: { code: "22023", message: "invoice_not_ready", details: "no_service_date,profile_incomplete" } },
  });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(await res.json(), { error: "preflight_failed", blockers: ["no_service_date", "profile_incomplete"] });
});

Deno.test("issue maps invalid_transition and order_not_done to 409 invalid_state with the reason", async () => {
  for (const reason of ["invalid_transition", "order_not_done"]) {
    const t = setup({ rpc: { data: null, error: { code: "22023", message: reason, details: null } } });
    const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "invalid_state", reason });
    assertEquals(writes(t.calls), []);
  }
});

Deno.test("issue maps the RPC's role check to 403 forbidden", async () => {
  const t = setup({ rpc: { data: null, error: { code: "42501", message: "not allowed" } } });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

Deno.test("a render error after finalize returns render_failed with issued: true and no update", async () => {
  const t = setup();
  const render = { ...t.render, einvoice: () => Promise.reject(new Error("boom")) };
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, render);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "render_failed", issued: true });
  assertEquals(writes(t.calls), []);
});

Deno.test("the totals guard of the e-invoice mapping is a render_failed too", async () => {
  const t = setup();
  const render = { ...t.render, einvoice: () => Promise.reject(new Error("einvoice_totals_mismatch: net")) };
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, render);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "render_failed", issued: true });
  assertEquals(writes(t.calls), []);
});

Deno.test("issue on an issued invoice without a file skips the RPC and renders (resume)", async () => {
  const t = setup({ invoice: issuedRow() });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, invoice_no: "RE-0007" });
  assertEquals(t.userCalls.filter((c) => c.method === "rpc"), []);
  assertEquals(t.einvoiceRendered.length, 1);
  assertEquals(writes(t.calls).map((c) => `${c.table}:${c.method}`), [
    "storage:werkbank-documents:upload",
    "werkbank.invoices:update",
  ]);
});

Deno.test("resume with the file already stored stamps the stored bytes and never removes", async () => {
  const stored = new Uint8Array([1, 2, 3, 4]);
  const t = setup({
    invoice: issuedRow(),
    opts: {
      storageUploadResult: { data: null, error: { statusCode: "409", message: "The resource already exists" } },
      storageDownloadResult: { data: new Blob([stored], { type: "application/pdf" }), error: null },
    },
  });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  const download = t.calls.find((c) => c.table === "storage:werkbank-documents" && c.method === "download");
  assertExists(download);
  assertEquals(download.args[0], PATH);
  const update = t.calls.find((c) => c.table === "werkbank.invoices" && c.method === "update");
  assertExists(update);
  assertEquals(update.args[0], { pdf_path: PATH, pdf_sha256: await sha256Hex(stored) });
  assertEquals(t.calls.filter((c) => c.method === "remove"), []);
});

Deno.test("issue on an issued invoice with a file is invalid_state (double issue)", async () => {
  const t = setup({ invoice: issuedRow({ pdf_path: PATH, pdf_sha256: "ab" }) });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "invalid_state" });
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
  assertEquals(t.einvoiceRendered.length, 0);
});

const SEND = { to: ["kunde@example.com"], cc: ["buchhaltung@example.com"], message: "Anbei die Rechnung." };
const STORED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x41, 0x33, 0x01]);
const stored = { storageDownloadResult: { data: new Blob([STORED]), error: null } };
interface SentEmail {
  template_name: string;
  recipient_email: string;
  reply_to?: string;
  locale?: string;
  org_id?: string;
  templateData: Record<string, string>;
  attachments: Array<{ filename: string; content_base64: string }>;
}
const emails = (t: { invokeCalls: Array<{ name: string; body: unknown }> }) =>
  t.invokeCalls.filter((c) => c.name === "send-transactional-email").map((c) => c.body as SentEmail);

// ── send ─────────────────────────────────────────────────────────────────────

Deno.test("send attaches the STORED file, never renders, and stamps sent_at and sent_to", async () => {
  const t = setup({ invoice: issuedRow({ pdf_path: PATH, pdf_sha256: "ab" }), opts: stored });
  const res = await handle(request({ action: "send", org_id: ORG, invoice_id: INV, ...SEND }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, email_sent: true });

  assertEquals(t.pdfRendered.length + t.einvoiceRendered.length, 0, "the renderer is never called in send");
  assertEquals(t.calls.filter((c) => c.method === "upload"), []);
  assertEquals(t.calls.find((c) => c.method === "download")?.args[0], PATH);

  const sent = emails(t);
  assertEquals(sent.length, 2, "one message per recipient");
  assertEquals(sent.map((m) => m.recipient_email), ["kunde@example.com", "buchhaltung@example.com"]);
  for (const m of sent) {
    assertEquals(m.template_name, "invoice-sent");
    assertEquals(m.reply_to, "buero@muster.de");
    assertEquals(m.locale, "de");
    assertEquals(m.org_id, ORG);
    assertEquals(m.attachments, [{ filename: "RE-0007.pdf", content_base64: encodeBase64(STORED) }]);
    assertEquals(m.templateData, {
      companyName: "Muster Sanitär", invoiceNo: "RE-0007", kind: "invoice",
      grossFormatted: new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(119),
      dueDateFormatted: "22.10.2026", message: "Anbei die Rechnung.",
    });
  }
  assert(sent[0].templateData.grossFormatted.includes("119,00"));

  const upd = t.calls.find((c) => c.method === "update");
  assertExists(upd);
  assertEquals(upd.args[0], { sent_at: "2026-06-01T12:00:00.000Z", sent_to: ["kunde@example.com", "buchhaltung@example.com"] });
  const filters = t.calls.filter((c) => c.table === "werkbank.invoices" && c.method === "eq").map((c) => c.args.join("="));
  assert(filters.includes(`id=${INV}`) && filters.includes(`org_id=${ORG}`));
});

Deno.test("send of a cancellation names the cancelled invoice", async () => {
  const t = setup({
    invoice: issuedRow({ type: "cancellation", invoice_no: "RE-0008", cancels_invoice_id: ORIG, pdf_path: PATH }),
    original: issuedRow({ id: ORIG, invoice_no: "RE-0003", status: "cancelled", pdf_path: "x" }),
    opts: stored,
  });
  const res = await handle(request({ action: "send", org_id: ORG, invoice_id: INV, ...SEND }), t.deps, t.render);
  assertEquals(res.status, 200);
  const data = emails(t)[0].templateData;
  assertEquals(data.kind, "cancellation");
  assertEquals(data.precedingNo, "RE-0003");
  assertEquals(emails(t)[0].attachments[0].filename, "RE-0008.pdf");
});

Deno.test("a cancelled original can still be resent", async () => {
  const t = setup({ invoice: issuedRow({ status: "cancelled", pdf_path: PATH }), opts: stored });
  const res = await handle(request({ action: "send", org_id: ORG, invoice_id: INV, ...SEND }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(emails(t).length, 2);
});

Deno.test("send without a recipient is a no_recipient preflight failure", async () => {
  for (const to of [[], ["  "]]) {
    const t = setup({ invoice: issuedRow({ pdf_path: PATH }), opts: stored });
    const res = await handle(request({ action: "send", org_id: ORG, invoice_id: INV, to, cc: ["x@example.com"], message: "" }), t.deps, t.render);
    assertEquals(res.status, 422);
    assertEquals(await res.json(), { error: "preflight_failed", blockers: ["no_recipient"] });
    assertEquals(emails(t), []);
    assertEquals(t.calls.filter((c) => c.method === "update"), []);
  }
});

Deno.test("send on a draft or an unstored invoice is invalid_state", async () => {
  for (const invoice of [invoiceRow(), issuedRow()]) {
    const t = setup({ invoice, opts: stored });
    const res = await handle(request({ action: "send", org_id: ORG, invoice_id: INV, ...SEND }), t.deps, t.render);
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "invalid_state" });
    assertEquals(emails(t), []);
  }
});

Deno.test("a failed email is send_failed (issued) and leaves sent_at alone", async () => {
  const t = setup({ invoice: issuedRow({ pdf_path: PATH }), opts: { ...stored, emailResult: { data: null, error: { message: "down" } } } });
  const res = await handle(request({ action: "send", org_id: ORG, invoice_id: INV, ...SEND }), t.deps, t.render);
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "send_failed", issued: true });
  assertEquals(t.calls.filter((c) => c.method === "update"), []);
});

Deno.test("send answers load_failed when the stored file cannot be read", async () => {
  const t = setup({ invoice: issuedRow({ pdf_path: PATH }) });
  const res = await handle(request({ action: "send", org_id: ORG, invoice_id: INV, ...SEND }), t.deps, t.render);
  assertEquals(res.status, 500);
  assertEquals(emails(t), []);
});

Deno.test("issue with send stores the file, then emails the stored bytes", async () => {
  const t = setup({ opts: stored });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV, send: SEND }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, invoice_no: "RE-0007", email_sent: true });
  assertEquals(t.einvoiceRendered.length, 1);
  assertEquals(t.pdfRendered.length, 0);
  // The attachment is the file that was just uploaded, not a second render.
  assertEquals(emails(t)[0].attachments[0].content_base64, encodeBase64(EINVOICE));
  assertEquals(t.calls.filter((c) => c.method === "download"), [], "no storage read needed after our own upload");
  const updates = t.calls.filter((c) => c.method === "update").map((c) => Object.keys(c.args[0] as object).sort().join(","));
  assertEquals(updates, ["pdf_path,pdf_sha256", "sent_at,sent_to"]);
});

Deno.test("issue with send and no recipient finalizes nothing", async () => {
  const t = setup();
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV, send: { to: [], cc: [], message: "" } }), t.deps, t.render);
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "preflight_failed", blockers: ["no_recipient"] });
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

Deno.test("issue with send reports send_failed with issued: true when the email fails", async () => {
  const t = setup({ opts: { emailResult: { data: null, error: { message: "down" } } } });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV, send: SEND }), t.deps, t.render);
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "send_failed", issued: true });
  assertEquals(t.calls.filter((c) => c.method === "update").length, 1, "the file is stamped, sent_at is not");
});

Deno.test("an upload failure after finalize reports issued: true and does not stamp", async () => {
  const t = setup({ opts: { storageUploadResult: { data: null, error: { statusCode: "500", message: "down" } } } });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "upload_failed", issued: true });
  assertEquals(t.calls.filter((c) => c.method === "update"), []);
});

Deno.test("issue of a cancellation renders with the original as the preceding invoice", async () => {
  const t = setup({
    rpc: { data: issuedRow({ type: "cancellation", cancels_invoice_id: ORIG, invoice_no: "RE-0008" }), error: null },
    invoice: invoiceRow({ type: "cancellation", cancels_invoice_id: ORIG }),
    original: issuedRow({ id: ORIG, invoice_no: "RE-0003", issue_date: "2026-09-30", status: "cancelled" }),
  });
  const res = await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(t.einvoiceRendered[0].type, "cancellation");
  assertEquals(t.einvoiceRendered[0].precedingInvoice, { number: "RE-0003", issueDate: "2026-09-30" });
});

Deno.test("issue loads the logo from the seller snapshot's logo path", async () => {
  const t = setup({
    invoice: issuedRow({ seller_snapshot: { ...sellerSnapshot, logo_path: `${ORG}/logo.png` } }),
    opts: { storageDownloadResult: { data: new Blob([new Uint8Array([9])], { type: "image/png" }), error: null } },
  });
  let logo: string | undefined;
  const render = {
    ...t.render,
    einvoice: (_d: InvoiceData, l?: string) => {
      logo = l;
      return Promise.resolve(EINVOICE);
    },
  };
  await handle(request({ action: "issue", org_id: ORG, invoice_id: INV }), t.deps, render);
  assertEquals(logo, `data:image/png;base64,${encodeBase64(new Uint8Array([9]))}`);
  assert(t.calls.some((c) => c.table === "storage:werkbank-assets" && c.args[0] === `${ORG}/logo.png`));
});

// ── download-url ─────────────────────────────────────────────────────────────

Deno.test("download-url signs the stored file for 60 s", async () => {
  const t = setup({ invoice: issuedRow({ pdf_path: PATH }) });
  const res = await handle(request({ action: "download-url", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { url: `https://signed.test/werkbank-documents/${PATH}` });
  const sign = t.calls.find((c) => c.method === "createSignedUrl");
  assertExists(sign);
  assertEquals(sign.args, [PATH, 60]);
});

Deno.test("download-url without a stored file is not_found", async () => {
  const t = setup();
  const res = await handle(request({ action: "download-url", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});
