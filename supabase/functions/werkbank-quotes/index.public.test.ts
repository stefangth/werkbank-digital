// Public token actions of werkbank-quotes (R6): view and decide, plus the R7 notifications.
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { makeFakeDeps, makeRequest, type FakeDepsOptions, type TableSeed } from "../_shared/testing.ts";
import type { EmailMessage } from "../_shared/deps.ts";
import type { QuotePdfData } from "../_shared/werkbank/pdf/quoteData.ts";
import { quoteConsentText } from "../_shared/werkbank/acceptance.ts";
import { sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import { handle } from "./index.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const QUOTE = "33333333-3333-4333-8333-333333333333";
const APP = "https://werkbank.test";
const TOKEN = "a".repeat(64);
const HASH = await sha256Hex(TOKEN);
const SENT_SHA = "5".repeat(64);
const SENT_PATH = `${ORG}/quotes/${QUOTE}-5555555555555555.pdf`;
const ACCEPTED_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const PNG_URL = `data:image/png;base64,${encodeBase64(PNG)}`;
// 22:30 UTC on Oct 7 is Oct 8 in Berlin: "today" for expiry is 2026-10-08.
const NOW = new Date("2026-10-07T22:30:00.000Z");

const profile = {
  org_id: ORG, company_name: "Muster Sanitär", legal_form: "GmbH", street: "Werkstr. 2", postal_code: "80331",
  city: "München", country_code: "DE", email: "buero@muster.de", phone: "089 123", tax_number: "143/123/45678",
  vat_id: null, logo_path: null,
};
const customer = {
  id: "c-1", org_id: ORG, kind: "private", first_name: "Anna", last_name: "Muster", company_name: null,
  street: "Hauptstr. 1", postal_code: "80331", city: "München", email: "anna@privat.example", phone: "0171 555",
};
const totals = {
  quote_id: QUOTE, order_id: null, net_total: 100, discount_total: 0, vat_total: 19, gross_total: 119,
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
    discount_percent: 0, valid_until: "2026-11-06", status: "sent", sent_at: "2026-10-07T08:00:00.000Z",
    sent_to: ["kunde@example.com", "cc@example.com"], pdf_path: SENT_PATH, pdf_sha256: SENT_SHA,
    accepted_pdf_path: null, access_token_hash: HASH, link_revoked_at: null, superseded_by: null,
    updated_at: "2026-10-07T08:00:00.000Z",
    ...over,
  };
}

interface Setup {
  quote?: Record<string, unknown> | null;
  /** What the guarded status update returns; null models zero matched rows. */
  stamp?: Record<string, unknown> | null;
  /** The quote as re-read by id after a lost status update (defaults to `quote`). */
  reloaded?: Record<string, unknown> | null;
  /** What werkbank.record_quote_decision returns (default "ok"). */
  rpc?: { data?: unknown; error?: unknown };
  profile?: Record<string, unknown>;
  opts?: FakeDepsOptions;
}

function setup(s: Setup = {}) {
  const tables: Record<string, TableSeed> = {
    "werkbank.quotes": [
      { when: { __write: true }, data: s.stamp === undefined ? { id: QUOTE } : s.stamp },
      { when: { access_token_hash: HASH }, data: s.quote === undefined ? quoteRow() : s.quote },
      { when: { id: QUOTE, org_id: ORG }, data: s.reloaded ?? (s.quote === undefined ? quoteRow() : s.quote) },
    ],
    "werkbank.quote_acceptances": [
      { data: { decision: "accepted" } },
    ],
    "werkbank.document_items": { data: items, error: null },
    "werkbank.document_totals": { data: totals, error: null },
    "werkbank.customers": { data: customer, error: null },
    "werkbank.company_profiles": { data: s.profile ?? profile, error: null },
    org_memberships: {
      data: [
        { user_id: "u-admin", role: "admin" },
        { user_id: "u-prod", role: "producer" },
      ],
      error: null,
    },
  };
  const fake = makeFakeDeps({
    envVars: { APP_URL: APP },
    now: NOW,
    tables,
    usersById: { "u-admin": { email: "chef@muster.de" }, "u-prod": { email: "planung@muster.de" } },
    rpcs: { "werkbank.record_quote_decision": s.rpc ?? { data: "ok", error: null } },
    ...s.opts,
  });
  const emails: EmailMessage[] = [];
  const sendEmail = fake.deps.sendEmail;
  fake.deps.sendEmail = (msg) => {
    emails.push(msg);
    fake.calls.push({ table: "email", method: "send", args: [msg] });
    return sendEmail(msg);
  };
  const rendered: QuotePdfData[] = [];
  const render = (data: QuotePdfData) => {
    rendered.push(data);
    return Promise.resolve(ACCEPTED_PDF);
  };
  return { ...fake, emails, rendered, render };
}

const request = (body: Record<string, unknown>) =>
  makeRequest({
    headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "TestBrowser/1.0" },
    body,
  });

const acceptBody = (over: Record<string, unknown> = {}) => ({
  action: "decide", token: TOKEN, decision: "accepted", signer_name: "Anna Muster",
  signature: { method: "drawn", pngDataUrl: PNG_URL }, consent: true,
  ...over,
});
const rejectBody = (over: Record<string, unknown> = {}) => ({
  action: "decide", token: TOKEN, decision: "rejected", signer_name: "Anna Muster", comment: "Zu teuer.",
  ...over,
});

function writes(calls: { table: string; method: string }[]) {
  return calls.filter((c) =>
    ["update", "insert", "upsert", "delete", "upload", "remove", "rpc"].includes(c.method)
  );
}
const notificationInserts = (calls: { table: string; method: string; args: unknown[] }[]) =>
  calls.filter((c) => c.table === "notifications" && c.method === "insert");

// ── states (Review Focus 3) ─────────────────────────────────────────────────

const STATES: Array<{ name: string; quote: Record<string, unknown> | null; status: number; body: Record<string, unknown> }> = [
  { name: "unknown token", quote: null, status: 404, body: { error: "not_found" } },
  { name: "superseded", quote: quoteRow({ status: "superseded", superseded_by: "q-2" }), status: 410, body: { error: "superseded" } },
  { name: "revoked", quote: quoteRow({ link_revoked_at: "2026-10-07T10:00:00.000Z" }), status: 410, body: { error: "revoked" } },
  { name: "rejected", quote: quoteRow({ status: "rejected" }), status: 410, body: { error: "decided", decision: "rejected" } },
  { name: "expired (valid until yesterday in Berlin)", quote: quoteRow({ valid_until: "2026-10-07" }), status: 410, body: { error: "expired" } },
];

for (const st of STATES) {
  for (const action of ["view", "decide"] as const) {
    Deno.test(`${action}: ${st.name} gives ${st.status} ${String(st.body.error)}`, async () => {
      const t = setup({ quote: st.quote });
      const body = action === "view" ? { action, token: TOKEN } : acceptBody();
      const res = await handle(request(body), t.deps, t.render);
      assertEquals(res.status, st.status);
      assertEquals(await res.json(), st.body);
      assertEquals(writes(t.calls), []);
      assertEquals(t.emails, []);
      assertEquals(t.rendered.length, 0);
    });
  }
}

for (const action of ["view", "decide"] as const) {
  Deno.test(`${action}: an accepted quote is decided and offers the accepted PDF`, async () => {
    const accepted = `${ORG}/quotes/${QUOTE}-accepted-0123456789abcdef.pdf`;
    const t = setup({ quote: quoteRow({ status: "accepted", accepted_pdf_path: accepted }) });
    const body = action === "view" ? { action, token: TOKEN } : acceptBody();
    const res = await handle(request(body), t.deps, t.render);
    assertEquals(res.status, 410);
    assertEquals(await res.json(), {
      error: "decided",
      decision: "accepted",
      pdf_url: `https://signed.test/werkbank-documents/${accepted}`,
    });
    assertEquals(writes(t.calls), []);
  });

  Deno.test(`${action}: a malformed token is not_found without a lookup`, async () => {
    const t = setup();
    for (const token of ["", "abc", "A".repeat(64), "g".repeat(64), 42]) {
      const body = action === "view" ? { action, token } : acceptBody({ token });
      const res = await handle(request(body), t.deps, t.render);
      assertEquals(res.status, 404);
      assertEquals(await res.json(), { error: "not_found" });
    }
    assertEquals(t.calls.filter((c) => c.table === "werkbank.quotes").length, 0);
  });
}

Deno.test("a quote valid until today in Berlin is still open", async () => {
  const t = setup({ quote: quoteRow({ valid_until: "2026-10-08" }) });
  const res = await handle(request({ action: "view", token: TOKEN }), t.deps, t.render);
  assertEquals(res.status, 200);
});

Deno.test("the token is looked up by its SHA-256 hash", async () => {
  const t = setup();
  await handle(request({ action: "view", token: TOKEN }), t.deps, t.render);
  assert(t.calls.some((c) => c.table === "werkbank.quotes" && c.method === "eq" && c.args[0] === "access_token_hash" && c.args[1] === HASH));
  assert(!t.calls.some((c) => c.method === "eq" && c.args[1] === TOKEN), "the raw token never reaches a query");
});

// ── view ─────────────────────────────────────────────────────────────────────

Deno.test("view returns display data, a 600 s PDF url and the consent text", async () => {
  const t = setup({ profile: { ...profile, logo_path: `${ORG}/logo.png` } });
  const res = await handle(request({ action: "view", token: TOKEN }), t.deps, t.render);
  assertEquals(res.status, 200);
  const body = await res.json();

  assertEquals(body.pdf_url, `https://signed.test/werkbank-documents/${SENT_PATH}`);
  const pdfSign = t.calls.find((c) => c.table === "storage:werkbank-documents" && c.method === "createSignedUrl");
  assertExists(pdfSign);
  assertEquals(pdfSign.args, [SENT_PATH, 600]);
  const logoSign = t.calls.find((c) => c.table === "storage:werkbank-assets" && c.method === "createSignedUrl");
  assertExists(logoSign);
  assertEquals(logoSign.args, [`${ORG}/logo.png`, 600]);

  assertEquals(body.consent_text, quoteConsentText("A-0042"));
  assertEquals(body.quote.quote_no, "A-0042");
  assertEquals(body.quote.status, "sent");
  assertEquals(body.quote.valid_until, "2026-11-06");
  assertEquals(body.quote.date, "2026-10-07");
  assertEquals(body.quote.subject, "Badsanierung");
  assertEquals(body.quote.recipient_lines, ["Anna Muster", "Hauptstr. 1", "80331 München"]);
  assertEquals(body.seller.company_name, "Muster Sanitär");
  assertEquals(body.seller.logo_url, `https://signed.test/werkbank-assets/${ORG}/logo.png`);
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0].title, "Bad");
  assertEquals(body.items[0].rows[0].name, "Fliesen");
  assertEquals(body.totals.gross, 119);

  // Signed storage URLs necessarily carry the object path; everything else is id-free.
  const text = JSON.stringify({ ...body, pdf_url: null, seller: { ...body.seller, logo_url: null } });
  for (const secret of ["anna@privat.example", "0171 555", HASH, TOKEN, QUOTE, ORG, "kunde@example.com"]) {
    assert(!text.includes(secret), `view leaks ${secret}`);
  }
  assertEquals(writes(t.calls), []);
});

Deno.test("view without a logo returns logo_url null", async () => {
  const t = setup();
  const res = await handle(request({ action: "view", token: TOKEN }), t.deps, t.render);
  const body = await res.json();
  assertEquals(body.seller.logo_url, null);
});

// ── decide: validation ───────────────────────────────────────────────────────

Deno.test("accept without a signature is 422 invalid_signature and records nothing", async () => {
  for (const signature of [undefined, null, { method: "drawn", pngDataUrl: "data:image/png;base64,AAAA" }, { method: "typed", typedName: "A" }]) {
    const t = setup();
    const res = await handle(request(acceptBody({ signature })), t.deps, t.render);
    assertEquals(res.status, 422);
    assertEquals(await res.json(), { error: "invalid_signature" });
    assertEquals(writes(t.calls), []);
  }
});

Deno.test("accept without consent is 422 consent_required", async () => {
  for (const consent of [undefined, false, "true"]) {
    const t = setup();
    const res = await handle(request(acceptBody({ consent })), t.deps, t.render);
    assertEquals(res.status, 422);
    assertEquals(await res.json(), { error: "consent_required" });
    assertEquals(writes(t.calls), []);
  }
});

Deno.test("a missing or too short signer name is 422 invalid_signer_name", async () => {
  const t = setup();
  const res = await handle(request(acceptBody({ signer_name: " A " })), t.deps, t.render);
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "invalid_signer_name" });
  assertEquals(writes(t.calls), []);
});

Deno.test("an unknown decision is 400 bad_request", async () => {
  const t = setup();
  const res = await handle(request(acceptBody({ decision: "maybe" })), t.deps, t.render);
  assertEquals(res.status, 400);
  assertEquals(writes(t.calls), []);
});

// ── decide: accept ───────────────────────────────────────────────────────────

const RPC = "rpc:werkbank.record_quote_decision";
const rpcArgs = (calls: { table: string; args: unknown[] }[]) =>
  calls.filter((c) => c.table === RPC).map((c) => c.args[0] as Record<string, unknown>);
const removedPaths = (calls: { method: string; args: unknown[] }[]) =>
  calls.filter((c) => c.method === "remove").flatMap((c) => c.args[0] as string[]);

/** Replaces werkbank.record_quote_decision with a call that never returns (the isolate dies). */
function crashAtDecision(t: ReturnType<typeof setup>) {
  const original = t.deps.admin.schema.bind(t.deps.admin);
  t.deps.admin.schema = ((name: "werkbank") => ({
    ...original(name),
    rpc: () => Promise.reject(new Error("isolate killed")),
  })) as unknown as typeof t.deps.admin.schema;
}

const sigPath = async () => `${ORG}/signatures/${QUOTE}-${(await sha256Hex(PNG)).slice(0, 16)}.png`;
const acceptedPath = async () => `${ORG}/quotes/${QUOTE}-accepted-${(await sha256Hex(ACCEPTED_PDF)).slice(0, 16)}.pdf`;

Deno.test("a valid accept stores the files, records the decision in one call, notifies and confirms", async () => {
  const t = setup();
  const res = await handle(request(acceptBody()), t.deps, t.render);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.pdf_url, `https://signed.test/werkbank-documents/${await acceptedPath()}`);

  // Files first, then the single atomic decision, then the side effects. The edge function never
  // writes quote_acceptances or quotes itself.
  assertEquals(writes(t.calls).map((c) => `${c.table}:${c.method}`), [
    "storage:werkbank-documents:upload",
    "storage:werkbank-documents:upload",
    `${RPC}:rpc`,
    "notifications:insert",
  ]);

  assertEquals(rpcArgs(t.calls), [{
    p_quote: QUOTE,
    p_decision: "accepted",
    p_signer_name: "Anna Muster",
    p_method: "drawn",
    p_typed_name: null,
    p_signature_image_path: await sigPath(),
    p_ip: "203.0.113.7",
    p_user_agent: "TestBrowser/1.0",
    p_consent_text: quoteConsentText("A-0042"),
    p_comment: null,
    p_accepted_pdf_path: await acceptedPath(),
  }]);

  const uploads = t.calls.filter((c) => c.method === "upload");
  assertEquals(uploads[0].args[0], await sigPath(), "content-addressed signature");
  assertEquals(uploads[0].args[1], PNG);
  assertEquals((uploads[0].args[2] as { upsert?: boolean }).upsert, false);
  assertEquals(uploads[1].args[0], await acceptedPath(), "content-addressed accepted PDF");
  assertEquals(uploads[1].args[1], ACCEPTED_PDF);
  assertEquals((uploads[1].args[2] as { upsert?: boolean }).upsert, false);
  assertEquals(removedPaths(t.calls), []);

  // The accepted PDF is the sent document (its date) plus the signature block.
  assertEquals(t.rendered.length, 1);
  assertEquals(t.rendered[0].date, "07.10.2026");
  assertEquals(t.rendered[0].watermark, undefined);
  assertEquals(t.rendered[0].acceptance, {
    name: "Anna Muster",
    decidedAt: "2026-10-08",
    signaturePngDataUrl: PNG_URL,
    typedName: undefined,
  });

  const notes = notificationInserts(t.calls);
  assertEquals(notes.length, 1);
  const rows = notes[0].args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.map((r) => r.user_id), ["u-admin", "u-prod"]);
  for (const r of rows) {
    assertEquals(r.type, "quote_accepted");
    assertEquals(r.related_entity_type, "werkbank_quote");
    assertEquals(r.related_entity_id, QUOTE);
    assertEquals(r.org_id, ORG);
    assert(String(r.message).includes("A-0042"));
  }
  assert(t.calls.some((c) => c.table === "org_memberships" && c.method === "in" &&
    JSON.stringify(c.args) === JSON.stringify(["role", ["admin", "producer"]])));

  const decided = t.emails.filter((e) => e.template_name === "quote-decided");
  assertEquals(decided.map((e) => e.recipient_email), ["chef@muster.de", "planung@muster.de"]);
  assertEquals(decided[0].templateData, {
    quote_no: "A-0042",
    customer_name: "Anna Muster",
    signer_name: "Anna Muster",
    decision: "accepted",
    comment: "",
    link: `${APP}/quotes/${QUOTE}`,
  });
  assertEquals(decided[0].attachments, undefined);

  const confirmations = t.emails.filter((e) => e.template_name === "quote-decision-confirmation");
  assertEquals(confirmations.length, 1);
  const c = confirmations[0];
  assertEquals(c.recipient_email, "kunde@example.com");
  assertEquals(c.locale, "de");
  assertEquals(c.reply_to, "buero@muster.de");
  assertEquals(c.templateData, {
    quote_no: "A-0042",
    company_name: "Muster Sanitär",
    signer_name: "Anna Muster",
    decision: "accepted",
    decided_at: "08.10.2026",
  });
  assertEquals(c.attachments?.length, 1);
  assertEquals(c.attachments?.[0].content_base64, encodeBase64(ACCEPTED_PDF));
  assertEquals(t.emails.length, 3);
});

Deno.test("a typed accept passes the typed name and uploads no image", async () => {
  const t = setup();
  const res = await handle(request(acceptBody({ signature: { method: "typed", typedName: "Anna Muster" } })), t.deps, t.render);
  assertEquals(res.status, 200);
  const [args] = rpcArgs(t.calls);
  assertEquals(args.p_method, "typed");
  assertEquals(args.p_typed_name, "Anna Muster");
  assertEquals(args.p_signature_image_path, null);
  assertEquals(t.calls.filter((c) => c.method === "upload").length, 1, "only the accepted PDF");
  assertEquals(t.rendered[0].acceptance?.typedName, "Anna Muster");
  assertEquals(t.rendered[0].acceptance?.signaturePngDataUrl, undefined);
});

Deno.test("a crash after the uploads leaves no decision, and the next accept still works", async () => {
  const crashed = setup();
  crashAtDecision(crashed);
  let threw = false;
  try {
    await handle(request(acceptBody()), crashed.deps, crashed.render);
  } catch {
    threw = true;
  }
  assert(threw, "the request dies at the decision call");
  // The edge function wrote no decision itself; the files are only unreferenced objects.
  assertEquals(crashed.calls.filter((c) => c.table.startsWith("werkbank.") && ["insert", "update", "delete"].includes(c.method)), []);
  assertEquals(notificationInserts(crashed.calls).length, 0);
  assertEquals(crashed.emails, []);

  // The retry finds identical bytes at the same content-addressed paths: that is success.
  const retry = setup({
    opts: { storageUploadResult: { data: null, error: { statusCode: "409", message: "The resource already exists" } } },
  });
  const res = await handle(request(acceptBody()), retry.deps, retry.render);
  assertEquals(res.status, 200);
  const crashedUploads = crashed.calls.filter((c) => c.method === "upload").map((c) => c.args[0]);
  const [args] = rpcArgs(retry.calls);
  assertEquals([args.p_signature_image_path, args.p_accepted_pdf_path], crashedUploads);
  assertEquals(removedPaths(retry.calls), [], "files that were already there are never removed");
  assertEquals(retry.emails.filter((e) => e.template_name === "quote-decision-confirmation").length, 1);
});

Deno.test("a second decide that the function reports as decided: 410 and nothing more is sent (Review Focus 4)", async () => {
  const first = setup();
  assertEquals((await handle(request(acceptBody()), first.deps, first.render)).status, 200);
  assertEquals(notificationInserts(first.calls).length, 1);
  assertEquals(first.emails.filter((e) => e.template_name === "quote-decision-confirmation").length, 1);

  // A second one passes the pre-check (stale read) and the function finds the decision made.
  const accepted = await acceptedPath();
  const second = setup({
    rpc: { data: "decided", error: null },
    reloaded: quoteRow({ status: "accepted", accepted_pdf_path: accepted }),
  });
  const res = await handle(request(acceptBody()), second.deps, second.render);
  assertEquals(res.status, 410);
  assertEquals(await res.json(), {
    error: "decided",
    decision: "accepted",
    pdf_url: `https://signed.test/werkbank-documents/${accepted}`,
  });
  assertEquals(rpcArgs(second.calls).length, 1);
  assertEquals(second.emails, []);
  assertEquals(notificationInserts(second.calls).length, 0);
  assertEquals(removedPaths(second.calls).length, 2, "this request's own uploads are removed");
});

for (const outcome of ["superseded", "revoked", "expired"] as const) {
  Deno.test(`the function reports ${outcome}: 410 ${outcome}, uploads removed, nothing sent`, async () => {
    const t = setup({ rpc: { data: outcome, error: null } });
    const res = await handle(request(acceptBody()), t.deps, t.render);
    assertEquals(res.status, 410);
    assertEquals(await res.json(), { error: outcome });
    assertEquals(removedPaths(t.calls).sort(), [await acceptedPath(), await sigPath()].sort());
    assertEquals(t.emails, []);
    assertEquals(notificationInserts(t.calls).length, 0);
  });
}

Deno.test("an error from the decision call is 500 and keeps the files (it may have committed)", async () => {
  const t = setup({ rpc: { data: null, error: { message: "fetch failed" } } });
  const res = await handle(request(acceptBody()), t.deps, t.render);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "update_failed" });
  assertEquals(removedPaths(t.calls), []);
  assertEquals(t.emails, []);
});

Deno.test("a failing render records nothing", async () => {
  const t = setup();
  const res = await handle(request(acceptBody()), t.deps, () => Promise.reject(new Error("boom")));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "render_failed" });
  assertEquals(writes(t.calls), []);
});

Deno.test("a failing email or notification never turns a recorded decision into an error", async () => {
  const t = setup();
  t.deps.sendEmail = () => Promise.reject(new Error("smtp down"));
  const res = await handle(request(acceptBody()), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
});

// ── decide: reject ───────────────────────────────────────────────────────────

Deno.test("reject records the comment, renders nothing and confirms without attachment", async () => {
  const t = setup();
  const res = await handle(request(rejectBody()), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });

  assertEquals(writes(t.calls).map((c) => `${c.table}:${c.method}`), [`${RPC}:rpc`, "notifications:insert"]);
  const [args] = rpcArgs(t.calls);
  assertEquals(args.p_decision, "rejected");
  assertEquals(args.p_comment, "Zu teuer.");
  assertEquals(args.p_method, null);
  assertEquals(args.p_signature_image_path, null);
  assertEquals(args.p_consent_text, null);
  assertEquals(args.p_accepted_pdf_path, null);
  assertEquals(t.rendered.length, 0);

  const rows = notificationInserts(t.calls)[0].args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.map((r) => r.type), ["quote_rejected", "quote_rejected"]);

  const decided = t.emails.filter((e) => e.template_name === "quote-decided");
  assertEquals(decided.length, 2);
  assertEquals(decided[0].templateData?.comment, "Zu teuer.");
  assertEquals(decided[0].templateData?.decision, "rejected");
  const confirmation = t.emails.find((e) => e.template_name === "quote-decision-confirmation");
  assertExists(confirmation);
  assertEquals(confirmation.recipient_email, "kunde@example.com");
  assertEquals(confirmation.templateData?.decision, "rejected");
  assertEquals(confirmation.attachments, undefined);
});
