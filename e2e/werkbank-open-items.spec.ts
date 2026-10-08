/**
 * Werkbank open items smoke (Teil 5): invoice A (3 hours, 207,06) is issued with "Nur abschliessen",
 * 100,00 is paid, the remainder is written off as Skonto (payment_state written_off). The create
 * notice button of a not yet overdue invoice is disabled with its tooltip, a dunning hold shows its
 * banner and is lifted again. Invoice B (69,02) is paid in full and cancelled; the cancellation and
 * a corrected copy are issued, the payment is transferred to the copy (B overpaid, then void; copy
 * paid). The werkbank schema (service role) is the oracle. The overdue notice path is not covered
 * here: no client can backdate an issued invoice, pgTAP, Deno and Vitest cover it.
 *
 * Needs the edge function: `supabase functions serve` next to the local stack. Runs in German.
 */
import { expect, test, type Page } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { createConfirmedUser, deleteUserByEmail, ensurePlatformAdmin } from "./helpers/users";
import { signOut } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const stamp = Date.now();
const SUPER_EMAIL = tagEmail("werkbank-super", "fixed");
const SUPER_PASSWORD = "E2eWerkbankSuper!1";
const ADMIN_EMAIL = tagEmail("werkbank-oi-admin", stamp);
const ADMIN_PASSWORD = "E2eWerkbankAdmin!1";
const CUSTOMER_EMAIL = tagEmail("werkbank-oi-kunde", stamp);
const ORG_SLUG = `e2e-werkbank-oi-${stamp}`;
const ORG_NAME = "E2E Werkbank Offene Posten";

const CUSTOMER = "Hausverwaltung Posten";
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


const GROSS_A = 207.06; // 3 h x 58,00 net + 19 % VAT
const GROSS_B = 69.02; // 1 h x 58,00 net + 19 % VAT

test.describe.configure({ mode: "serial" });

test.describe("Werkbank open items", () => {
  let orgId = "";
  let adminUserId = "";
  let invoiceA = "";
  let invoiceB = "";
  let copyId = "";

  const werkbank = () => adminClient().schema("werkbank");
  const balance = async (id: string) =>
    (await werkbank().from("invoice_balances").select("claim, paid, written_off, open_amount, payment_state").eq("invoice_id", id).single()).data;

  /** Issues the open draft with "Nur abschliessen" and returns the number shown on the page. */
  async function issueOnly(page: Page): Promise<string> {
    await page.getByRole("button", { name: "Abschließen", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Nur abschließen" }).click();
    await expect(page.getByText("Ausgestellt", { exact: true })).toBeVisible({ timeout: 45_000 });
    const number = page.getByText(/^RE-\d{4}$/).first();
    await expect(number).toBeVisible();
    return (await number.textContent())!;
  }

  /** Writes a done order with one catalog position of `hours` hours and returns the new invoice id. */
  async function invoiceFromOrder(page: Page, hours: number): Promise<string> {
    await page.goto("/orders");
    await page.getByRole("button", { name: "Auftrag anlegen", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Kunde").click();
    await page.getByRole("option", { name: new RegExp(CUSTOMER) }).click();
    await dialog.getByRole("button", { name: "Auftrag erstellen" }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const orderId = page.url().split("/orders/")[1].split(/[?#]/)[0];

    await page.getByRole("button", { name: "Katalogartikel hinzufügen" }).click();
    await page.getByRole("option", { name: new RegExp(CATALOG_ITEM) }).click();
    await expect.poll(async () => {
      const { data } = await werkbank().from("document_items").select("id").eq("order_id", orderId);
      return data?.length;
    }, { timeout: 15_000 }).toBe(1);
    const { error } = await werkbank().from("document_items").update({ quantity: hours }).eq("order_id", orderId);
    expect(error).toBeNull();

    await page.reload();
    await page.getByRole("button", { name: "Beginnen", exact: true }).click();
    await expect.poll(async () => (await werkbank().from("orders").select("status").eq("id", orderId).single()).data?.status, { timeout: 15_000 }).toBe("in_progress");
    await page.getByRole("button", { name: "Erledigt", exact: true }).click();
    await expect.poll(async () => (await werkbank().from("orders").select("status").eq("id", orderId).single()).data?.status, { timeout: 15_000 }).toBe("done");
    await page.getByRole("button", { name: "Rechnung erstellen" }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 15_000 });
    return page.url().split("/invoices/")[1].split(/[?#]/)[0];
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

  test("setup: a Handwerksbetrieb org with an admin, master data and a company profile", async ({ page }) => {
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
        org_id: orgId, customer_no: "K-90003", kind: "property_manager", company_name: CUSTOMER,
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
  });

  test("invoice A: partial payment, hold with banner, write-off as Skonto", async ({ page }) => {
    await loginAsOrgAdmin(page);
    invoiceA = await invoiceFromOrder(page, 3);
    expect(await issueOnly(page)).toBe("RE-0001");
    expect((await balance(invoiceA))?.claim).toBe(GROSS_A);

    const payments = page.locator('section[aria-labelledby="invoice-payments"]');
    await payments.getByRole("button", { name: "Zahlung erfassen" }).click();
    const payDialog = page.getByRole("dialog");
    await payDialog.locator("#entry-amount").fill("100,00");
    await payDialog.getByRole("button", { name: "Zahlung buchen" }).click();
    await expect(payments.getByText("Zahlung", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await balance(invoiceA))?.payment_state, { timeout: 15_000 }).toBe("partial");
    expect(await balance(invoiceA)).toMatchObject({ paid: 100, written_off: 0, open_amount: 107.06 });

    // The invoice is not overdue yet: the notice button is disabled and says why, also on keyboard focus.
    const dunning = page.locator('section[aria-labelledby="invoice-dunning"]');
    const create = dunning.getByRole("button", { name: /erstellen$/ });
    await expect(create).toBeDisabled();
    await create.focus();
    await expect(page.getByRole("tooltip").getByText("Die Rechnung ist noch nicht überfällig.")).toBeVisible();

    // A hold shows its banner and can be lifted again.
    await dunning.getByRole("button", { name: "Mahnsperre setzen" }).click();
    const holdDialog = page.getByRole("dialog");
    await holdDialog.getByLabel("Grund").fill("Zahlung zugesagt");
    await holdDialog.getByRole("button", { name: "Sperre setzen" }).click();
    await expect(dunning.getByText(/Mahnsperre aktiv: Zahlung zugesagt/)).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await werkbank().from("dunning_holds").select("reason").eq("invoice_id", invoiceA)).data?.length, { timeout: 15_000 }).toBe(1);
    await dunning.getByRole("button", { name: "Aufheben" }).click();
    await expect(dunning.getByText(/Mahnsperre aktiv/)).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await werkbank().from("dunning_holds").select("reason").eq("invoice_id", invoiceA)).data?.length, { timeout: 15_000 }).toBe(0);

    // The remainder is written off as Skonto.
    await payments.getByRole("button", { name: "Ausbuchen", exact: true }).click();
    const writeOff = page.getByRole("dialog");
    await writeOff.getByRole("radio", { name: "Skonto" }).click();
    await writeOff.getByRole("button", { name: "Ausbuchen", exact: true }).click();
    await expect.poll(async () => (await balance(invoiceA))?.payment_state, { timeout: 15_000 }).toBe("written_off");
    expect(await balance(invoiceA)).toMatchObject({ paid: 100, written_off: 107.06, open_amount: 0 });
  });

  test("invoice B: paid in full, cancelled, the payment moves to the corrected copy", async ({ page }) => {
    await loginAsOrgAdmin(page);
    invoiceB = await invoiceFromOrder(page, 1);
    expect(await issueOnly(page)).toBe("RE-0002");

    const payments = page.locator('section[aria-labelledby="invoice-payments"]');
    await payments.getByRole("button", { name: "Zahlung erfassen" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Zahlung buchen" }).click();
    await expect.poll(async () => (await balance(invoiceB))?.payment_state, { timeout: 15_000 }).toBe("paid");
    expect(await balance(invoiceB)).toMatchObject({ claim: GROSS_B, paid: GROSS_B, open_amount: 0 });

    // Cancelling and issuing the cancellation leaves the payment as credit on B.
    await page.getByRole("button", { name: "Stornieren", exact: true }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Stornorechnung anlegen" }).click();
    await expect(page).not.toHaveURL(new RegExp(invoiceB));
    expect(await issueOnly(page)).toBe("RE-0003");
    expect((await balance(invoiceB))?.payment_state).toBe("overpaid");

    await page.goto(`/invoices/${invoiceB}`);
    await page.getByRole("button", { name: "Korrigierte Rechnung anlegen" }).click();
    await expect(page).not.toHaveURL(new RegExp(invoiceB));
    copyId = page.url().split("/invoices/")[1].split(/[?#]/)[0];
    expect(await issueOnly(page)).toBe("RE-0004");
    expect((await balance(copyId))?.payment_state).toBe("open");

    // Move the payment from B to the copy, from the credit notice that names the amount.
    await page.goto(`/invoices/${invoiceB}`);
    const creditNotice = page.locator('section[aria-labelledby="invoice-payments"]').getByRole("alert");
    await expect(creditNotice).toContainText("Zahlung auf die korrigierte Rechnung umbuchen?");
    await creditNotice.getByRole("button", { name: "Umbuchen" }).click();
    const transfer = page.getByRole("dialog");
    await transfer.getByRole("radio", { name: /RE-0004/ }).click();
    await transfer.getByLabel("Grund").fill("Korrigierte Rechnung");
    await transfer.getByRole("button", { name: "Zahlung umbuchen" }).click();
    await expect.poll(async () => (await balance(copyId))?.payment_state, { timeout: 15_000 }).toBe("paid");
    expect((await balance(invoiceB))?.payment_state).toBe("void");
  });
});
