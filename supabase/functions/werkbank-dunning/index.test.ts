// werkbank-dunning (R5, R6): preview, issue (incl. resume), send and download-url.
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  asTypedClient,
  createFakeClient,
  type FakeDepsOptions,
  makeFakeDeps,
  makeRequest,
  type RecordedCall,
  type TableSeed,
} from "../_shared/testing.ts";
import type { DunningData } from "../_shared/werkbank/pdf/dunningData.ts";
import { sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { handle } from "./index.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const INV = "33333333-3333-4333-8333-333333333333";
const CUST = "44444444-4444-4444-8444-444444444444";
const NOTICE = "55555555-5555-4555-8555-555555555555";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const PATH = `${ORG}/dunning/${NOTICE}.pdf`;

const profile = {
  org_id: ORG, company_name: "Muster Sanitär", legal_form: "GmbH", street: "Werkstr. 2", postal_code: "80331",
  city: "München", country_code: "DE", phone: null, email: "buero@muster.de", website: null,
  tax_number: "143/123/45678", vat_id: null, register_court: null, register_number: null,
  iban: "DE02120300000000202051", bic: null, bank_name: null, logo_path: null, dunning_deadline_days: 7,
  reminder_text: null, dunning1_text: null, dunning2_text: null,
};
const { org_id: _o, ...sellerSnapshot } = profile;
const buyerSnapshot = {
  name: "Muster, Anna", street: "Hauptstr. 1", postal_code: "80331", city: "München", country_code: "DE",
  customer_no: "K-10001", vat_id: null, invoice_email: "re@example.com", is_private: true, billing_override: false,
  property: null,
};
const invoice = {
  id: INV, org_id: ORG, type: "invoice", invoice_no: "RE-0007", status: "issued", issue_date: "2026-09-01",
  due_date: "2026-09-15", seller_snapshot: sellerSnapshot, buyer_snapshot: buyerSnapshot,
  pdf_path: `${ORG}/invoices/${INV}.pdf`, customer_id: CUST, contact_id: null, sent_at: null, sent_to: null,
};
const balance = {
  invoice_id: INV, org_id: ORG, claim: 119, paid: 19, open_amount: 100, written_off: 0, property_name: "Haus A",
};
const noticeRow = (over: Record<string, unknown> = {}) => ({
  id: NOTICE, org_id: ORG, invoice_id: INV, stage: 1, notice_date: "2026-10-08", payment_deadline: "2026-10-15",
  invoice_gross: 119, paid_amount: 19, open_amount: 100, delivery: "email", pdf_path: null, pdf_sha256: null,
  sent_at: null, sent_to: null, ...over,
});

interface Setup {
  invoice?: Record<string, unknown> | null;
  notices?: Record<string, unknown>[];
  orgKind?: string;
  rpc?: { data?: unknown; error?: unknown };
  customer?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  balance?: Record<string, unknown> | null;
  hold?: Record<string, unknown> | null;
  /** The caller is also a producer of OTHER_ORG (a handwerk org). */
  memberOfOther?: boolean;
  opts?: FakeDepsOptions;
}

function setup(s: Setup = {}) {
  const tables: Record<string, TableSeed> = {
    org_memberships: [
      { when: { org_id: ORG }, data: { role: "producer" } },
      ...(s.memberOfOther ? [{ when: { org_id: OTHER_ORG }, data: { role: "producer" } }] : []),
    ],
    organizations: [
      { when: { id: ORG }, data: { org_kind: s.orgKind ?? "handwerk" } },
      { when: { id: OTHER_ORG }, data: { org_kind: "handwerk" } },
    ],
    "werkbank.invoices": [{ when: { id: INV, org_id: ORG }, data: s.invoice === undefined ? invoice : s.invoice }],
    "werkbank.invoice_balances": { data: s.balance === undefined ? balance : s.balance, error: null },
    "werkbank.dunning_holds": { data: s.hold ?? null, error: null },
    "werkbank.company_profiles": { data: profile, error: null },
    "werkbank.customers": { data: s.customer === undefined ? { invoice_email: "kunde@example.com", email: null } : s.customer, error: null },
    "werkbank.contacts": { data: s.contact ?? null, error: null },
    "werkbank.dunning_notices": [
      { when: { id: NOTICE, org_id: ORG }, data: (s.notices ?? [])[0] ?? null },
      // The notice is scoped by org: looked up under another org it does not exist.
      { when: { id: NOTICE, org_id: OTHER_ORG }, data: null },
      { when: { __write: true }, data: { id: NOTICE } },
      { data: s.notices ?? [], error: null },
    ],
  };
  const fake = makeFakeDeps({ authUser: { id: "u-1" }, tables, ...s.opts });
  const user = createFakeClient({
    authUser: { id: "u-1" },
    rpcs: { "werkbank.create_dunning_notice": s.rpc ?? { data: noticeRow(), error: null } },
  });
  fake.deps.userClient = () => asTypedClient(user.client);
  const rendered: DunningData[] = [];
  const render = {
    pdf: (data: DunningData) => {
      rendered.push(data);
      return Promise.resolve(PDF);
    },
  };
  return { ...fake, userCalls: user.calls, rendered, render };
}

const request = (body: Record<string, unknown>) => makeRequest({ headers: { Authorization: "Bearer user-jwt" }, body });
const issueBody = { action: "issue", org_id: ORG, invoice_id: INV, delivery: "email", payment_deadline: "2026-10-15" };

function writes(calls: RecordedCall[]) {
  return calls.filter((c) => ["update", "insert", "upsert", "delete", "upload", "remove", "rpc"].includes(c.method));
}

// ── gates ────────────────────────────────────────────────────────────────────

Deno.test("a producer of another org is forbidden", async () => {
  const t = setup();
  const res = await handle(request({ action: "preview", org_id: OTHER_ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

Deno.test("a non-handwerk org gets not_handwerk", async () => {
  const t = setup({ orgKind: "production" });
  const res = await handle(request(issueBody), t.deps, t.render);
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

Deno.test("bad requests: unknown action, missing id, malformed deadline, bad delivery", async () => {
  const t = setup();
  assertEquals((await handle(request({ action: "x", org_id: ORG, invoice_id: INV }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ action: "preview", org_id: ORG }), t.deps, t.render)).status, 400);
  const bad = await handle(request({ ...issueBody, payment_deadline: "15.10.2026" }), t.deps, t.render);
  assertEquals(bad.status, 400);
  assertEquals(await bad.json(), { error: "bad_request" });
  assertEquals((await handle(request({ ...issueBody, delivery: "fax" }), t.deps, t.render)).status, 400);
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

// ── preview ──────────────────────────────────────────────────────────────────

Deno.test("preview renders the next stage as a draft and writes nothing", async () => {
  const t = setup({ notices: [noticeRow({ pdf_path: PATH })] });
  const res = await handle(
    request({ action: "preview", org_id: ORG, invoice_id: INV, payment_deadline: "2026-10-20" }),
    t.deps,
    t.render,
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/pdf");
  assertEquals(new Uint8Array(await res.arrayBuffer()), PDF);
  const d = t.rendered[0];
  assertEquals(d.draft, true);
  assertEquals(d.stage, 2);
  assertEquals(d.paymentDeadline, "2026-10-20");
  assertEquals(d.invoiceGross, 119);
  assertEquals(d.paidAmount, 19);
  assertEquals(d.openAmount, 100);
  assertEquals(d.invoice.propertyName, "Haus A");
  assertEquals(d.earlierNotices, [{ stage: 1, date: "2026-10-08" }]);
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

Deno.test("preview defaults the deadline to Berlin today plus the profile's days", async () => {
  const t = setup({ opts: { now: new Date("2026-10-08T22:30:00Z") } });
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  // 22:30 UTC is already Oct 9 in Berlin; +7 days.
  assertEquals(t.rendered[0].noticeDate, "2026-10-09");
  assertEquals(t.rendered[0].paymentDeadline, "2026-10-16");
  assertEquals(t.rendered[0].stage, 1);
});

Deno.test("preview with stage 3 already issued is 409 max_stage", async () => {
  const t = setup({ notices: [noticeRow({ stage: 3 })] });
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "not_allowed", blockers: ["max_stage"] });
});

// ── issue ────────────────────────────────────────────────────────────────────

Deno.test("issue calls the RPC with the caller's client, uploads, then stamps through the admin client", async () => {
  const t = setup();
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { notice_id: NOTICE, stage: 1 });

  const rpc = t.userCalls.find((c) => c.table === "rpc:werkbank.create_dunning_notice");
  assertExists(rpc);
  assertEquals(rpc.args[0], { p_invoice: INV, p_delivery: "email", p_payment_deadline: "2026-10-15" });
  assertEquals(t.calls.filter((c) => c.method === "rpc"), []);

  assertEquals(t.rendered[0].draft, false);
  const upload = t.calls.find((c) => c.method === "upload");
  assertExists(upload);
  assertEquals(upload.args[0], PATH);
  assertEquals(upload.args[2], { contentType: "application/pdf", upsert: false });
  const update = t.calls.find((c) => c.table === "werkbank.dunning_notices" && c.method === "update");
  assertExists(update);
  assertEquals(update.args[0], { pdf_path: PATH, pdf_sha256: await sha256Hex(PDF) });
  assert(t.calls.some((c) => c.table === "werkbank.dunning_notices" && c.method === "is" && c.args[0] === "pdf_path"));
});

Deno.test("issue without a deadline sends the profile default to the RPC", async () => {
  const t = setup({ opts: { now: new Date("2026-10-08T10:00:00Z") } });
  const { payment_deadline: _p, ...body } = issueBody;
  const res = await handle(request(body), t.deps, t.render);
  assertEquals(res.status, 200);
  const rpc = t.userCalls.find((c) => c.table === "rpc:werkbank.create_dunning_notice");
  assertEquals((rpc?.args[0] as Record<string, unknown>).p_payment_deadline, "2026-10-15");
});

Deno.test("dunning_not_allowed maps to 409 with the blockers and stores nothing", async () => {
  const t = setup({
    rpc: { data: null, error: { code: "22023", message: "dunning_not_allowed", details: "nothing_open,on_hold" } },
  });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "not_allowed", blockers: ["nothing_open", "on_hold"] });
  assertEquals(writes(t.calls), []);
  assertEquals(t.rendered.length, 0);
});

Deno.test("the RPC's role check is 403", async () => {
  const t = setup({ rpc: { data: null, error: { code: "42501", message: "not allowed" } } });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

Deno.test("a render error after the RPC is render_failed with issued, and the retry resumes without the RPC", async () => {
  const t = setup();
  const failing = { pdf: () => Promise.reject(new Error("boom")) };
  const res = await handle(request(issueBody), t.deps, failing);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "render_failed", issued: true });
  assertEquals(writes(t.calls), []);

  // The notice now exists without a file: the second call renders and stores that one.
  const retry = setup({ notices: [noticeRow()] });
  const res2 = await handle(request(issueBody), retry.deps, retry.render);
  assertEquals(res2.status, 200);
  assertEquals(await res2.json(), { notice_id: NOTICE, stage: 1 });
  assertEquals(retry.userCalls.filter((c) => c.method === "rpc"), []);
  assertEquals(retry.rendered.length, 1);
  assertEquals(retry.calls.find((c) => c.method === "upload")?.args[0], PATH);
  assert(retry.calls.some((c) => c.table === "werkbank.dunning_notices" && c.method === "update"));
});

Deno.test("an upload failure is render_failed with issued", async () => {
  const t = setup({ opts: { storageUploadResult: { data: null, error: { statusCode: "500", message: "down" } } } });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "render_failed", issued: true });
});

Deno.test("the file already stored: its bytes are stamped, nothing is removed", async () => {
  const stored = new Uint8Array([1, 2, 3]);
  const t = setup({
    notices: [noticeRow()],
    opts: {
      storageUploadResult: { data: null, error: { statusCode: "409", message: "The resource already exists" } },
      storageDownloadResult: { data: new Blob([stored]), error: null },
    },
  });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 200);
  const update = t.calls.find((c) => c.table === "werkbank.dunning_notices" && c.method === "update");
  assertEquals(update?.args[0], { pdf_path: PATH, pdf_sha256: await sha256Hex(stored) });
  assertEquals(t.calls.filter((c) => c.method === "remove"), []);
});

Deno.test("print delivery never sends an email, even with a send field", async () => {
  for (const send of [undefined, {}, { to: ["kunde@example.com"] }, true]) {
    const t = setup();
    const res = await handle(request({ ...issueBody, delivery: "print", ...(send === undefined ? {} : { send }) }), t.deps, t.render);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { notice_id: NOTICE, stage: 1 });
    assertEquals(emails(t), []);
    assertEquals(t.invokeCalls.length, 0);
    assertEquals(t.calls.filter((c) => c.method === "download"), []);
  }
});

Deno.test("issue without a send field stores the notice and emails nothing", async () => {
  const t = setup();
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(t.invokeCalls.length, 0);
});

// ── send ─────────────────────────────────────────────────────────────────────

const STORED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x41]);
const stored = { storageDownloadResult: { data: new Blob([STORED]), error: null } };
interface SentEmail {
  template_name: string;
  recipient_email: string;
  reply_to?: string;
  locale?: string;
  org_id?: string;
  idempotency_key?: string;
  templateData: Record<string, string>;
  attachments: Array<{ filename: string; content_base64: string }>;
}
const emails = (t: { invokeCalls: Array<{ name: string; body: unknown }> }) =>
  t.invokeCalls.filter((c) => c.name === "send-transactional-email").map((c) => c.body as SentEmail);
const sendBody = { action: "send", org_id: ORG, notice_id: NOTICE };
const filed = (over: Record<string, unknown> = {}) => noticeRow({ pdf_path: PATH, pdf_sha256: "ab", ...over });

Deno.test("send with an explicit to attaches the stored notice and the stored invoice, never renders", async () => {
  const t = setup({ notices: [filed({ stage: 2 })], opts: stored });
  const res = await handle(request({ ...sendBody, to: ["Chef@Example.com"], cc: ["buchhaltung@example.com"], message: "Bitte zahlen." }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, email_sent: true });
  assertEquals(t.rendered.length, 0);
  assertEquals(t.calls.filter((c) => c.method === "upload"), []);
  assertEquals(
    t.calls.filter((c) => c.method === "download").map((c) => c.args[0]),
    [PATH, `${ORG}/invoices/${INV}.pdf`],
  );

  const sent = emails(t);
  assertEquals(sent.map((m) => m.recipient_email), ["Chef@Example.com", "buchhaltung@example.com"]);
  for (const m of sent) {
    assertEquals(m.template_name, "dunning-sent");
    assertEquals(m.reply_to, "buero@muster.de");
    assertEquals(m.locale, "de");
    assertEquals(m.org_id, ORG);
    assertEquals(m.attachments.map((a) => a.filename), ["Mahnung-RE-0007-2.pdf", "Rechnung-RE-0007.pdf"]);
    assertEquals(m.attachments[0].content_base64, encodeBase64(STORED));
    assertEquals(m.attachments[1].content_base64, encodeBase64(STORED));
    assertEquals(m.templateData, {
      companyName: "Muster Sanitär",
      stageTitle: "1. Mahnung",
      invoiceNo: "RE-0007",
      openAmount: "100,00\u00a0\u20ac",
      paymentDeadline: "15.10.2026",
      message: "Bitte zahlen.",
    });
  }
  const update = t.calls.find((c) => c.table === "werkbank.dunning_notices" && c.method === "update");
  assertExists(update);
  const patch = update.args[0] as Record<string, unknown>;
  assertEquals(Object.keys(patch).sort(), ["sent_at", "sent_to"]);
  assertEquals(patch.sent_to, ["Chef@Example.com", "buchhaltung@example.com"]);
});

Deno.test("send without to uses the customer's invoice email", async () => {
  const t = setup({
    notices: [filed()],
    customer: { invoice_email: "re@example.com", email: "info@example.com" },
    contact: { email: "kontakt@example.com" },
    opts: stored,
  });
  const res = await handle(request(sendBody), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(emails(t).map((m) => m.recipient_email), ["re@example.com"]);
});

Deno.test("send without to falls back to the contact, then the customer's general address", async () => {
  const a = setup({
    notices: [filed()],
    customer: { invoice_email: null, email: "info@example.com" },
    contact: { email: "kontakt@example.com" },
    invoice: { ...invoice, contact_id: "66666666-6666-4666-8666-666666666666" },
    opts: stored,
  });
  await handle(request(sendBody), a.deps, a.render);
  assertEquals(emails(a).map((m) => m.recipient_email), ["kontakt@example.com"]);

  const b = setup({ notices: [filed()], customer: { invoice_email: null, email: "info@example.com" }, opts: stored });
  await handle(request(sendBody), b.deps, b.render);
  assertEquals(emails(b).map((m) => m.recipient_email), ["info@example.com"]);
});

Deno.test("send without any address is 409 no_recipient and emails nothing", async () => {
  const t = setup({ notices: [filed()], customer: { invoice_email: null, email: null }, opts: stored });
  const res = await handle(request(sendBody), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "no_recipient" });
  assertEquals(emails(t), []);
  assertEquals(t.calls.filter((c) => c.method === "update"), []);
});

Deno.test("send with a malformed address is 422 invalid_recipient", async () => {
  const t = setup({ notices: [filed()], opts: stored });
  const res = await handle(request({ ...sendBody, to: ["kein-mail"] }), t.deps, t.render);
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "invalid_recipient" });
  assertEquals(emails(t), []);
});

Deno.test("send of a notice without a stored file is 409 pdf_missing", async () => {
  const t = setup({ notices: [noticeRow()], opts: stored });
  const res = await handle(request(sendBody), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "pdf_missing" });
  assertEquals(emails(t), []);
});

Deno.test("send of an unknown notice is 404", async () => {
  const t = setup({ opts: stored });
  const res = await handle(request(sendBody), t.deps, t.render);
  assertEquals(res.status, 404);
});

Deno.test("send without the invoice file is 409 invoice_file_missing and emails nothing", async () => {
  const t = setup({ notices: [filed()], invoice: { ...invoice, pdf_path: null }, opts: stored });
  const res = await handle(request(sendBody), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "invoice_file_missing" });
  assertEquals(emails(t), []);
  assertEquals(t.calls.filter((c) => c.method === "update"), []);
});

Deno.test("a failed email is 502 send_failed with issued and leaves sent_at unchanged", async () => {
  const t = setup({ notices: [filed()], opts: { ...stored, emailResult: { data: null, error: { message: "resend down" } } } });
  const res = await handle(request(sendBody), t.deps, t.render);
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "send_failed", issued: true });
  assertEquals(t.calls.filter((c) => c.table === "werkbank.dunning_notices" && c.method === "update"), []);
});

Deno.test("a message over 5000 characters is bad_request and emails nothing", async () => {
  const t = setup({ notices: [filed()], opts: stored });
  const res = await handle(request({ ...sendBody, message: "x".repeat(5001) }), t.deps, t.render);
  assertEquals(res.status, 422);
  assertEquals(emails(t), []);
});

Deno.test("send needs a notice_id", async () => {
  const t = setup({ opts: stored });
  const res = await handle(request({ action: "send", org_id: ORG }), t.deps, t.render);
  assertEquals(res.status, 400);
});

Deno.test("issue with send: {} stores the notice, then emails it using the issue's own bytes", async () => {
  const t = setup({ opts: stored });
  const res = await handle(request({ ...issueBody, send: {} }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { notice_id: NOTICE, stage: 1, email_sent: true });
  const sequence = t.calls.filter((c) =>
    c.method === "upload" || (c.table === "werkbank.dunning_notices" && c.method === "update")
  ).map((c) => c.method);
  assertEquals(sequence, ["upload", "update", "update"], "file, stamp, then sent_at");
  const sent = emails(t);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].recipient_email, "kunde@example.com");
  assertEquals(sent[0].attachments[0].filename, "Mahnung-RE-0007-1.pdf");
  assertEquals(sent[0].attachments[0].content_base64, encodeBase64(PDF));
  assertEquals(sent[0].attachments[1].content_base64, encodeBase64(STORED));
});

Deno.test("issue with send and no recipient is 409 before any write", async () => {
  const t = setup({ customer: { invoice_email: null, email: null } });
  const res = await handle(request({ ...issueBody, send: {} }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "no_recipient" });
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

Deno.test("issue with send and a missing invoice file is 409 before any write", async () => {
  const t = setup({ invoice: { ...invoice, pdf_path: null } });
  const res = await handle(request({ ...issueBody, send: {} }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "invoice_file_missing" });
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

Deno.test("issue with send and a failing email keeps the stored notice: 502 issued", async () => {
  const t = setup({ opts: { ...stored, emailResult: { data: null, error: { message: "down" } } } });
  const res = await handle(request({ ...issueBody, send: { to: ["a@example.com"] } }), t.deps, t.render);
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "send_failed", issued: true });
  assert(t.calls.some((c) => c.method === "upload"));
  assertEquals(t.calls.filter((c) => c.table === "werkbank.dunning_notices" && c.method === "update").length, 1, "only the file stamp");
});

Deno.test("issue with a malformed send field is 400", async () => {
  const t = setup();
  const res = await handle(request({ ...issueBody, send: "yes" }), t.deps, t.render);
  assertEquals(res.status, 400);
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

// ── download-url ─────────────────────────────────────────────────────────────

Deno.test("download-url returns a 60 s signed URL", async () => {
  const t = setup({ notices: [noticeRow({ pdf_path: PATH })] });
  const res = await handle(request({ action: "download-url", org_id: ORG, notice_id: NOTICE }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { url: `https://signed.test/werkbank-documents/${PATH}` });
  const sign = t.calls.find((c) => c.method === "createSignedUrl");
  assertEquals(sign?.args, [PATH, 60]);
});

Deno.test("download-url without a stored file is 409 pdf_missing; unknown notice is 404", async () => {
  const t = setup({ notices: [noticeRow()] });
  const res = await handle(request({ action: "download-url", org_id: ORG, notice_id: NOTICE }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "pdf_missing" });
  const none = setup();
  const res2 = await handle(request({ action: "download-url", org_id: ORG, notice_id: NOTICE }), none.deps, none.render);
  assertEquals(res2.status, 404);
});

// ── business blockers on resume with send and on send (R13) ───────────────────

const NOW = new Date("2026-10-08T10:00:00Z");
const blockedCases: Array<[string, Partial<Setup>, string]> = [
  ["paid", { balance: { ...balance, paid: 119, open_amount: 0 } }, "nothing_open"],
  ["overpaid", { balance: { ...balance, paid: 130, open_amount: -11 } }, "nothing_open"],
  ["held without end", { hold: { until: null } }, "on_hold"],
  ["held until today", { hold: { until: "2026-10-08" } }, "on_hold"],
  ["cancelled", { invoice: { ...invoice, status: "cancelled" }, balance: { ...balance, claim: 0, open_amount: -19 } }, "not_issued"],
];

Deno.test("resume with send on a held invoice without an address answers not_allowed on_hold, not no_recipient", async () => {
  const t = setup({
    notices: [noticeRow()], hold: { until: null }, customer: { invoice_email: null, email: null },
    opts: { ...stored, now: NOW },
  });
  const res = await handle(request({ ...issueBody, send: {} }), t.deps, t.render);
  assertEquals(res.status, 409);
  const out = await res.json();
  assertEquals(out.error, "not_allowed");
  assert(out.blockers.includes("on_hold"));
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

for (const [label, over, blocker] of blockedCases) {
  Deno.test(`resume with send on a ${label} invoice is 409 ${blocker} and neither renders nor emails`, async () => {
    const t = setup({ notices: [noticeRow()], ...over, opts: { ...stored, now: NOW } });
    const res = await handle(request({ ...issueBody, send: {} }), t.deps, t.render);
    assertEquals(res.status, 409);
    const out = await res.json();
    assertEquals(out.error, "not_allowed");
    assert(out.blockers.includes(blocker), `blockers ${out.blockers} include ${blocker}`);
    assertEquals(t.rendered.length, 0);
    assertEquals(emails(t), []);
    assertEquals(writes([...t.calls, ...t.userCalls]), []);
  });

  Deno.test(`send on a ${label} invoice is 409 ${blocker} and emails nothing`, async () => {
    const t = setup({ notices: [filed()], ...over, opts: { ...stored, now: NOW } });
    const res = await handle(request(sendBody), t.deps, t.render);
    assertEquals(res.status, 409);
    const out = await res.json();
    assertEquals(out.error, "not_allowed");
    assert(out.blockers.includes(blocker), `blockers ${out.blockers} include ${blocker}`);
    assertEquals(emails(t), []);
    assertEquals(t.calls.filter((c) => c.method === "update"), []);
  });
}

Deno.test("resume without send still stores the notice of a paid invoice", async () => {
  const t = setup({ notices: [noticeRow({ delivery: "print" })], balance: { ...balance, open_amount: 0 }, opts: { now: NOW } });
  const res = await handle(request({ ...issueBody, delivery: "print" }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(t.rendered.length, 1);
  assertEquals(t.calls.find((c) => c.method === "upload")?.args[0], PATH);
});

Deno.test("resume with send on an open invoice renders, stores and emails", async () => {
  const t = setup({ notices: [noticeRow()], hold: { until: "2026-10-07" }, opts: { ...stored, now: NOW } });
  const res = await handle(request({ ...issueBody, send: {} }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { notice_id: NOTICE, stage: 1, email_sent: true });
  assertEquals(emails(t).length, 1);
});

Deno.test("send on an open invoice with an ended hold goes out", async () => {
  const t = setup({ notices: [filed()], hold: { until: "2026-10-07" }, opts: { ...stored, now: NOW } });
  const res = await handle(request(sendBody), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(emails(t).length, 1);
});

Deno.test("send of another org's notice is 404 for a producer of that other org", async () => {
  const t = setup({ notices: [filed()], memberOfOther: true, opts: stored });
  const res = await handle(request({ ...sendBody, org_id: OTHER_ORG }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
  assertEquals(emails(t), []);
});

// ── deadline and preview guards (R15) ─────────────────────────────────────────

Deno.test("a payment_deadline before Berlin today or not a calendar date is 400 before any write", async () => {
  // 22:30 UTC on Oct 8 is Oct 9 in Berlin: Oct 8 is already in the past.
  const t = setup({ opts: { now: new Date("2026-10-08T22:30:00Z") } });
  for (const d of ["2026-10-08", "2026-02-30", "2026-13-01"]) {
    const res = await handle(request({ ...issueBody, payment_deadline: d }), t.deps, t.render);
    assertEquals(res.status, 400, d);
    assertEquals(await res.json(), { error: "bad_request" });
  }
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
  const ok = await handle(request({ ...issueBody, payment_deadline: "2026-10-09" }), t.deps, t.render);
  assertEquals(ok.status, 200);
});

Deno.test("preview refuses a cancelled invoice and a cancellation invoice", async () => {
  for (const inv of [{ ...invoice, status: "cancelled" }, { ...invoice, type: "cancellation" }]) {
    const t = setup({ invoice: inv });
    const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "not_allowed", blockers: ["not_issued"] });
    assertEquals(t.rendered.length, 0);
  }
});
