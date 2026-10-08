/**
 * Werkbank order to invoice smoke (Teil 4): a Handwerksbetrieb admin completes the company
 * profile with an IBAN, writes an order for a seeded customer and completes it, creates the
 * invoice from the order, sets the service date and issues it with "Nur abschliessen" (no email
 * needed). The order shows as invoiced. The admin then cancels the invoice, issues the
 * cancellation (the order is done again) and issues a corrected copy. The stored PDF of the
 * invoice must carry the embedded factur-x.xml. The werkbank schema (service role) is the oracle.
 *
 * Needs the edge function: `supabase functions serve` next to the local stack.
 * Runs in German: handwerk orgs have the language package enabled by provisioning.
 */
import { expect, test, type Page } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { createConfirmedUser, deleteUserByEmail, ensurePlatformAdmin } from "./helpers/users";
import { navViaSidebar, signOut } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const stamp = Date.now();
const SUPER_EMAIL = tagEmail("werkbank-super", "fixed");
const SUPER_PASSWORD = "E2eWerkbankSuper!1";
const ADMIN_EMAIL = tagEmail("werkbank-inv-admin", stamp);
const ADMIN_PASSWORD = "E2eWerkbankAdmin!1";
const CUSTOMER_EMAIL = tagEmail("werkbank-inv-kunde", stamp);
const ORG_SLUG = `e2e-werkbank-inv-${stamp}`;
const ORG_NAME = "E2E Werkbank Rechnung";

const CUSTOMER = "Hausverwaltung Rechnung";
const CATALOG_ITEM = "Stundensatz Geselle";
const IBAN = "DE89 3704 0044 0532 0130 00";

test.use({ locale: "de-DE" });

// The shared login helpers click an English "Sign in" button; the login page follows the
// browser language, so this spec signs in through the German label.
async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^(anmelden|sign in)$/i }).click();
}

async function loginAsOrgAdmin(page: Page): Promise<void> {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page).toHaveURL(/\/(today|get-running|dashboard)/, { timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Werkbank order to invoice", () => {
  let orgId = "";
  let adminUserId = "";
  let orderId = "";
  let invoiceId = "";

  const werkbank = () => adminClient().schema("werkbank");
  const orderStatus = async () => (await werkbank().from("orders").select("status").eq("id", orderId).single()).data?.status;

  /** Issues the open draft with "Nur abschliessen" and returns the number shown on the page. */
  async function issueOnly(page: Page): Promise<string> {
    await page.getByRole("button", { name: "Abschließen", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Nur abschließen" }).click();
    await expect(page.getByText("Ausgestellt", { exact: true })).toBeVisible({ timeout: 45_000 });
    const number = page.getByText(/^RE-\d{4}$/).first();
    await expect(number).toBeVisible();
    return (await number.textContent())!;
  }

  test.beforeAll(async () => {
    await ensurePlatformAdmin(SUPER_EMAIL, SUPER_PASSWORD);
    await deleteUserByEmail(ADMIN_EMAIL);
    adminUserId = (await createConfirmedUser(ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  });

  test.afterAll(async () => {
    await adminClient().from("organizations").delete().eq("slug", ORG_SLUG);
    await deleteUserByEmail(ADMIN_EMAIL);
  });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("setup: a Handwerksbetrieb org with an admin and seeded master data", async ({ page }) => {
    await login(page, SUPER_EMAIL, SUPER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await page.goto("/platform");
    await expect(page.getByRole("heading", { name: /platform console/i })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /new organization/i }).click();
    await page.getByLabel("Name").fill(ORG_NAME);
    await page.getByLabel("Slug").fill(ORG_SLUG);
    await page.getByLabel("Workspace type").click();
    await page.getByRole("option", { name: /Handwerksbetrieb|Trade business/ }).click();
    await page.getByLabel("First admin email").fill(ADMIN_EMAIL);
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(ORG_SLUG)).toBeVisible({ timeout: 15_000 });

    const admin = adminClient();
    const { data: org } = await admin.from("organizations").select("id, org_kind").eq("slug", ORG_SLUG).single();
    expect(org?.org_kind).toBe("handwerk");
    orgId = org!.id;

    const { error } = await admin
      .from("org_memberships")
      .upsert({ org_id: orgId, user_id: adminUserId, role: "admin" }, { onConflict: "org_id,user_id,role" });
    expect(error).toBeNull();

    const customer = await werkbank()
      .from("customers")
      .insert({
        org_id: orgId, customer_no: "K-90002", kind: "property_manager", company_name: CUSTOMER,
        street: "Rathausplatz 1", postal_code: "20095", city: "Hamburg", email: CUSTOMER_EMAIL,
      })
      .select("id")
      .single();
    expect(customer.error).toBeNull();

    const item = await werkbank()
      .from("catalog_items")
      .insert({ org_id: orgId, name: CATALOG_ITEM, unit_code: "HUR", labour_price: 58, material_price: 0, vat_rate: 19 });
    expect(item.error).toBeNull();

    await signOut(page);
  });

  test("the admin completes the company profile with an IBAN", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await page.goto("/settings?tab=company");

    await page.getByLabel("Firmenname", { exact: true }).fill("Muster Haustechnik GmbH");
    await page.getByLabel("Straße und Hausnummer").fill("Werkstattweg 3");
    await page.getByLabel("PLZ").fill("20097");
    await page.getByLabel("Ort", { exact: true }).fill("Hamburg");
    await page.getByLabel("E-Mail", { exact: true }).fill("info@muster-haustechnik.example");
    await page.getByLabel("Steuernummer").fill("201/123/45678");
    await page.getByLabel(/^IBAN/).fill(IBAN);
    await page.locator('button[type="submit"]', { hasText: "Speichern" }).first().click();
    await expect(page.getByText("Firmendaten gespeichert")).toBeVisible({ timeout: 15_000 });

    const { data } = await werkbank().from("company_profiles").select("company_name, iban").eq("org_id", orgId);
    expect(data).toHaveLength(1);
    expect(data![0].iban?.replace(/\s/g, "")).toBe(IBAN.replace(/\s/g, ""));
  });

  test("the admin writes an order and completes it", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await navViaSidebar(page, /^aufträge$/i);
    await page.getByRole("button", { name: "Auftrag anlegen", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Kunde").click();
    await page.getByRole("option", { name: new RegExp(CUSTOMER) }).click();
    await dialog.getByRole("button", { name: "Auftrag erstellen" }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 15_000 });
    orderId = page.url().split("/orders/")[1].split(/[?#]/)[0];

    await page.getByRole("button", { name: "Katalogartikel hinzufügen" }).click();
    await page.getByRole("option", { name: new RegExp(CATALOG_ITEM) }).click();
    await expect.poll(async () => {
      const { data } = await werkbank().from("document_items").select("kind").eq("order_id", orderId);
      return (data ?? []).map((r) => r.kind);
    }, { timeout: 15_000 }).toEqual(["item"]);

    await page.getByRole("button", { name: "Beginnen", exact: true }).click();
    await expect.poll(orderStatus, { timeout: 15_000 }).toBe("in_progress");
    await page.getByRole("button", { name: "Erledigt", exact: true }).click();
    await expect.poll(orderStatus, { timeout: 15_000 }).toBe("done");
  });

  test("the invoice is created from the order and issued without sending", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await page.goto(`/orders/${orderId}`);
    await page.getByRole("button", { name: "Rechnung erstellen" }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 15_000 });
    invoiceId = page.url().split("/invoices/")[1].split(/[?#]/)[0];

    await page.getByRole("button", { name: /^Leistungsdatum von/ }).click();
    // The draft starts with today as the service date; day 5 of the shown month is a changed value
    // (the month can only be the current one, and day 5 is never today's outside-month cell).
    await page.getByRole("grid").getByText("5", { exact: true }).click();
    await expect.poll(async () => {
      const { data } = await werkbank().from("invoices").select("service_date_from").eq("id", invoiceId).single();
      return data?.service_date_from?.slice(8);
    }, { timeout: 15_000 }).toBe("05");

    expect(await issueOnly(page)).toBe("RE-0001");

    const { data: invoice } = await werkbank().from("invoices").select("status, type, invoice_no, pdf_path").eq("id", invoiceId).single();
    expect(invoice).toMatchObject({ status: "issued", type: "invoice", invoice_no: "RE-0001" });
    expect(invoice!.pdf_path).toBeTruthy();
    expect(await orderStatus()).toBe("invoiced");

    await page.goto("/orders");
    await expect(page.getByRole("row", { name: new RegExp(CUSTOMER) })).toContainText("Abgerechnet", { timeout: 15_000 });
  });

  test("the stored PDF is a Factur-X file with the embedded XML", async () => {
    const { data: invoice } = await werkbank().from("invoices").select("pdf_path").eq("id", invoiceId).single();
    const { data: blob, error } = await adminClient().storage.from("werkbank-documents").download(invoice!.pdf_path!);
    expect(error).toBeNull();
    const bytes = Buffer.from(await blob!.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.toString("latin1")).toContain("factur-x.xml");
  });

  test("cancelling issues RE-0002 and reopens the order, a corrected copy gets RE-0003", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await page.goto(`/invoices/${invoiceId}`);
    await page.getByRole("button", { name: "Stornieren", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Stornorechnung anlegen" }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(new RegExp(invoiceId));
    expect(await issueOnly(page)).toBe("RE-0002");

    const { data: cancelled } = await werkbank().from("invoices").select("status").eq("id", invoiceId).single();
    expect(cancelled?.status).toBe("cancelled");
    expect(await orderStatus()).toBe("done");

    await page.goto(`/invoices/${invoiceId}`);
    await page.getByRole("button", { name: "Korrigierte Rechnung anlegen" }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(new RegExp(invoiceId));
    expect(await issueOnly(page)).toBe("RE-0003");

    const { data: all } = await werkbank().from("invoices").select("invoice_no, type, status").eq("org_id", orgId).order("invoice_no");
    expect(all).toEqual([
      { invoice_no: "RE-0001", type: "invoice", status: "cancelled" },
      { invoice_no: "RE-0002", type: "cancellation", status: "issued" },
      { invoice_no: "RE-0003", type: "invoice", status: "issued" },
    ]);
    expect(await orderStatus()).toBe("invoiced");
  });
});
