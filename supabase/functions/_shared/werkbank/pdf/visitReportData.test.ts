import { assert, assertEquals } from "jsr:@std/assert@1";
import { makeFakeDeps, type TableSeed } from "../../testing.ts";
import { loadVisitReportData, PHOTO_BUDGET_BYTES } from "./visitReportData.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const CUST = "44444444-4444-4444-8444-444444444444";
const PROP = "55555555-5555-4555-8555-555555555555";
const R1 = "66666666-6666-4666-8666-666666666661";
const R2 = "66666666-6666-4666-8666-666666666662";

const profile = {
  org_id: ORG, company_name: "Muster Sanitär", legal_form: "GmbH", street: "Werkstr. 2", postal_code: "80331", city: "München",
  country_code: "DE", phone: null, email: "buero@muster.de", website: null, tax_number: null, vat_id: null, register_court: null,
  register_number: null, iban: null, bic: null, bank_name: null, logo_path: null,
};
const order = { id: ORDER, org_id: ORG, order_no: "AU-0042", customer_id: CUST, property_id: PROP, subject: "Bad", status: "done" };
const customer = { id: CUST, org_id: ORG, kind: "private", first_name: "Anna", last_name: "Muster", company_name: null, street: "Hauptstr. 1", postal_code: "80331", city: "München" };
const property = { id: PROP, org_id: ORG, name: "Haus Eiche", street: "Eichenweg 3", postal_code: "80333", city: "München" };
const items = [
  { id: "t", kind: "title", name: "Sanitär", sort_order: 0 },
  { id: "i", kind: "item", name: "Ventil", description: null, quantity: 2, unit_code: "H87", material_price: 10, labour_price: 5, line_net: 30, sort_order: 1 },
];
const r1 = {
  id: R1, org_id: ORG, order_id: ORDER, technician_name: "Ben Berg", visit_date: "2026-10-06", body: "Ventil getauscht",
  locked_at: "2026-10-06T10:00:00Z", signer_name: "Frau Meier", signature_path: `${ORG}/${ORDER}/${R1}/signature.png`, signed_at: "2026-10-06T10:00:00Z",
};
const r2 = {
  id: R2, org_id: ORG, order_id: ORDER, technician_name: "Ben Berg", visit_date: "2026-10-07", body: "Nacharbeit",
  locked_at: null, signer_name: null, signature_path: null, signed_at: null,
};
const photos = [
  { id: "p2", org_id: ORG, report_id: R1, path: `${ORG}/${ORDER}/${R1}/b.jpg`, position: 1 },
  { id: "p1", org_id: ORG, report_id: R1, path: `${ORG}/${ORDER}/${R1}/a.jpg`, position: 0 },
];

function setup(opts: { photos?: Record<string, unknown>[]; blob?: unknown } = {}) {
  const tables: Record<string, TableSeed> = {
    "werkbank.orders": [{ when: { org_id: ORG, id: ORDER }, data: order }, { data: null }],
    "werkbank.company_profiles": [{ when: { org_id: ORG }, data: profile }, { data: null }],
    "werkbank.customers": [{ when: { org_id: ORG, id: CUST }, data: customer }, { data: null }],
    "werkbank.properties": [{ when: { org_id: ORG, id: PROP }, data: property }, { data: null }],
    "werkbank.document_items": [{ when: { org_id: ORG, order_id: ORDER }, data: items }, { data: [] }],
    "werkbank.visit_reports": [
      { when: { org_id: ORG, order_id: ORDER, [`__in:id`]: JSON.stringify([R2]) }, data: [r2] },
      { when: { org_id: ORG, order_id: ORDER }, data: [r1, r2] },
      { data: [] },
    ],
    "werkbank.visit_report_photos": [{ when: { org_id: ORG }, data: opts.photos ?? photos }, { data: [] }],
  };
  const blob = opts.blob ?? new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  return makeFakeDeps({ tables, storageDownloadResult: { data: blob, error: null } });
}

Deno.test("loads the order header, price-free items and the reports with images", async () => {
  const t = setup();
  const d = await loadVisitReportData(t.deps.admin, ORG, ORDER);
  assert(d);
  assertEquals(d.orderNumber, "AU-0042");
  assertEquals(d.customer, "Anna Muster");
  assertEquals(d.location, ["Haus Eiche", "Eichenweg 3", "80333 München"]);
  assertEquals(d.seller.company_name, "Muster Sanitär");
  assertEquals(d.sections, [{ title: "Sanitär", number: "1", rows: [{ kind: "item", number: "1.1", name: "Ventil", description: undefined, quantity: 2, unit: "Stk" }] }]);
  assertEquals(JSON.stringify(d.sections).includes("unitPrice") || JSON.stringify(d.sections).includes("lineNet"), false);
  assertEquals(d.reports.map((r) => r.id), [R1, R2]);
  assertEquals(d.reports[0].draft, false);
  assertEquals(d.reports[1].draft, true);
  assertEquals(d.reports[0].photos, ["data:image/jpeg;base64,AQID", "data:image/jpeg;base64,AQID"]);
  assertEquals(d.reports[0].signature, { name: "Frau Meier", signedAt: "2026-10-06T10:00:00Z", imageDataUrl: "data:image/jpeg;base64,AQID" });
  assertEquals(d.reports[1].signature, null);
  assertEquals(d.reports.map((r) => r.morePhotos), [false, false]);
  const downloads = t.calls.filter((c) => c.method === "download");
  assertEquals(downloads.map((c) => [c.table, c.args[0]]), [
    ["storage:werkbank-visits", `${ORG}/${ORDER}/${R1}/a.jpg`],
    ["storage:werkbank-visits", `${ORG}/${ORDER}/${R1}/b.jpg`],
    ["storage:werkbank-visits", `${ORG}/${ORDER}/${R1}/signature.png`],
  ]);
  // Every read is scoped to the org (the admin client bypasses RLS).
  for (const table of ["werkbank.orders", "werkbank.company_profiles", "werkbank.customers", "werkbank.properties", "werkbank.document_items", "werkbank.visit_reports", "werkbank.visit_report_photos"]) {
    assert(t.calls.some((c) => c.table === table && c.method === "eq" && c.args[0] === "org_id" && c.args[1] === ORG), table);
  }
});

Deno.test("an order of another org is not returned", async () => {
  const t = setup();
  assertEquals(await loadVisitReportData(t.deps.admin, OTHER, ORDER), null);
  assertEquals(t.calls.filter((c) => c.table === "werkbank.visit_reports").length, 0);
});

Deno.test("report_ids narrows the reports", async () => {
  const t = setup();
  const d = await loadVisitReportData(t.deps.admin, ORG, ORDER, [R2]);
  assertEquals(d?.reports.map((r) => r.id), [R2]);
  assert(t.calls.some((c) => c.table === "werkbank.visit_reports" && c.method === "in" && c.args[0] === "id"));
});

Deno.test("a missing company profile is profile_missing", async () => {
  const tables = { "werkbank.orders": { data: order, error: null }, "werkbank.company_profiles": { data: null, error: null } };
  const fake = makeFakeDeps({ tables });
  let message = "";
  await loadVisitReportData(fake.deps.admin, ORG, ORDER).catch((e) => (message = String((e as Error).message)));
  assertEquals(message, "profile_missing");
});

Deno.test("photos stop at the byte budget; the skipped reports are flagged, signatures still load", async () => {
  // Reports to the fake as 15 MB each: two fit into 40 MB, the third does not.
  const big = { type: "image/jpeg", size: 15 * 1024 * 1024, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) };
  const many = [
    ...photos,
    { id: "p3", org_id: ORG, report_id: R1, path: `${ORG}/${ORDER}/${R1}/c.jpg`, position: 2 },
    { id: "p4", org_id: ORG, report_id: R2, path: `${ORG}/${ORDER}/${R2}/d.jpg`, position: 0 },
  ];
  assert(2 * big.size <= PHOTO_BUDGET_BYTES && 3 * big.size > PHOTO_BUDGET_BYTES);
  const t = setup({ photos: many, blob: big });
  const d = await loadVisitReportData(t.deps.admin, ORG, ORDER);
  assertEquals(d?.reports.map((r) => r.photos.length), [2, 0]);
  assertEquals(d?.reports.map((r) => r.morePhotos), [true, true]);
  assertEquals(d?.reports[0].signature?.imageDataUrl, "data:image/jpeg;base64,AQID");
  // Nothing after the first photo over the budget is downloaded.
  assertEquals(t.calls.filter((c) => c.method === "download").map((c) => String(c.args[0]).split("/").pop()), ["a.jpg", "b.jpg", "c.jpg", "signature.png"]);
});
