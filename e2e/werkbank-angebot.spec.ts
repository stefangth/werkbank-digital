/**
 * Werkbank quote to order smoke (Teil 3): a Handwerksbetrieb admin fills the company profile,
 * writes a quote (title, catalog item, text line) for a seeded customer, sends it, the customer accepts it online with a typed
 * signature in a fresh browser context, and the admin turns the accepted quote into a scheduled
 * order with a technician. The werkbank schema (service role) is the oracle for the stored state.
 *
 * Mail capture: the local stack has no mailbox, but organizations flagged `is_demo` divert every
 * transactional email into `demo_captured_sends` (rendered HTML included) instead of Resend. The
 * org is flagged right before the quote is sent, and the customer link is read from the captured
 * `quote-sent` email. Only the token is taken from the link: the link host is whatever APP_URL
 * says, so the customer page is opened on the local baseURL.
 *
 * Runs in German: the client UI language follows the browser, and handwerk orgs have the
 * language package enabled by provisioning.
 */
import { expect, test, type Page } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { createConfirmedUser, deleteUserByEmail, ensurePlatformAdmin } from "./helpers/users";
import { navViaSidebar, signOut } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const stamp = Date.now();
const SUPER_EMAIL = tagEmail("werkbank-super", "fixed");
const SUPER_PASSWORD = "E2eWerkbankSuper!1";
const ADMIN_EMAIL = tagEmail("werkbank-ang-admin", stamp);
const ADMIN_PASSWORD = "E2eWerkbankAdmin!1";
const CUSTOMER_EMAIL = tagEmail("werkbank-ang-kunde", stamp);
const ORG_SLUG = `e2e-werkbank-ang-${stamp}`;
const ORG_NAME = "E2E Werkbank Angebot";

const CUSTOMER = "Hausverwaltung Angebot";
const TITLE_LINE = "Wartung Heizungsanlage";
const CATALOG_ITEM = "Stundensatz Geselle";
const TEXT_LINE = "Anfahrt nach Vereinbarung";
const SUBJECT = "Heizungswartung Musterstr. 5";
const TECHNICIAN = "Monteur Beispiel";
const SIGNER = "Erika Mustermann";

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

test.describe("Werkbank quote to order", () => {
  let orgId = "";
  let adminUserId = "";
  let technicianId = "";
  let quoteId = "";
  let token = "";

  const werkbank = () => adminClient().schema("werkbank");

  test.beforeAll(async () => {
    await ensurePlatformAdmin(SUPER_EMAIL, SUPER_PASSWORD);
    await deleteUserByEmail(ADMIN_EMAIL);
    adminUserId = (await createConfirmedUser(ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  });

  test.afterAll(async () => {
    // Deleting the org cascades to its memberships, the werkbank rows and the captured emails.
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

    // Master data is not what this spec exercises, so it is seeded through the service role.
    const customer = await werkbank()
      .from("customers")
      .insert({
        org_id: orgId, customer_no: "K-90001", kind: "property_manager", company_name: CUSTOMER,
        street: "Rathausplatz 1", postal_code: "20095", city: "Hamburg", email: CUSTOMER_EMAIL,
      })
      .select("id")
      .single();
    expect(customer.error).toBeNull();

    const item = await werkbank()
      .from("catalog_items")
      .insert({ org_id: orgId, name: CATALOG_ITEM, unit_code: "HUR", labour_price: 58, material_price: 0, vat_rate: 19 });
    expect(item.error).toBeNull();

    const tech = await admin.from("artists").insert({ org_id: orgId, name: TECHNICIAN }).select("id").single();
    expect(tech.error).toBeNull();
    technicianId = tech.data!.id;

    await signOut(page);
  });

  test("the admin fills in the company profile", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await page.goto("/settings?tab=company");

    await page.getByLabel("Firmenname", { exact: true }).fill("Muster Haustechnik GmbH");
    await page.getByLabel("Straße und Hausnummer").fill("Werkstattweg 3");
    await page.getByLabel("PLZ").fill("20097");
    await page.getByLabel("Ort", { exact: true }).fill("Hamburg");
    await page.getByLabel("E-Mail", { exact: true }).fill("info@muster-haustechnik.example");
    await page.getByLabel("Steuernummer").fill("201/123/45678");
    // The settings page also shows a disabled Speichern of another card; click the enabled one.
    await page.getByRole("button", { name: "Speichern", exact: true, disabled: false }).click();
    await expect(page.getByText("Firmendaten gespeichert")).toBeVisible({ timeout: 15_000 });

    const { data } = await werkbank().from("company_profiles").select("company_name, tax_number").eq("org_id", orgId);
    expect(data).toEqual([{ company_name: "Muster Haustechnik GmbH", tax_number: "201/123/45678" }]);
  });

  test("the admin writes a quote with a title, a catalog item and a text line", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await navViaSidebar(page, /^angebote$/i);
    await expect(page).toHaveURL(/\/quotes/);

    await page.getByRole("button", { name: "Angebot anlegen", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Kunde").click();
    await page.getByRole("option", { name: new RegExp(CUSTOMER) }).click();
    await dialog.getByRole("button", { name: "Entwurf anlegen" }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}/, { timeout: 15_000 });
    quoteId = page.url().split("/quotes/")[1].split(/[?#]/)[0];

    await page.getByLabel("Betreff", { exact: true }).fill(SUBJECT);
    await page.getByLabel("Betreff", { exact: true }).blur();

    // A title first, stored before the next line is added so the order of the lines is fixed.
    await page.getByRole("button", { name: "Titel hinzufügen" }).click();
    await page.getByLabel("Titel", { exact: true }).fill(TITLE_LINE);
    await page.getByLabel("Titel", { exact: true }).blur();
    await expect.poll(async () => {
      const { data } = await werkbank().from("document_items").select("kind, name").eq("quote_id", quoteId);
      return data ?? [];
    }, { timeout: 15_000 }).toEqual([{ kind: "title", name: TITLE_LINE }]);

    await page.getByRole("button", { name: "Katalogartikel hinzufügen" }).click();
    await page.getByRole("option", { name: new RegExp(CATALOG_ITEM) }).click();
    await page.getByRole("button", { name: "Text hinzufügen" }).click();
    await page.getByLabel("Text", { exact: true }).fill(TEXT_LINE);
    await page.getByLabel("Text", { exact: true }).blur();

    // The editor saves on blur; the oracle waits for all three rows to be stored, in order.
    await expect.poll(async () => {
      const { data } = await werkbank().from("document_items").select("kind, sort_order").eq("quote_id", quoteId);
      return [...(data ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((r) => r.kind);
    }, { timeout: 15_000 }).toEqual(["title", "item", "text"]);

    const { data: quote } = await werkbank().from("quotes").select("status, quote_no, subject").eq("id", quoteId).single();
    expect(quote).toMatchObject({ status: "draft", subject: SUBJECT });
    expect(quote!.quote_no).toMatch(/^A-/);
  });

  test("sending the quote captures the customer email with the link", async ({ page }) => {
    // Flag the org as a demo org so the transactional email is captured instead of delivered.
    const flag = await adminClient().from("organizations").update({ is_demo: true }).eq("id", orgId);
    expect(flag.error).toBeNull();

    await loginAsOrgAdmin(page);
    await page.goto(`/quotes/${quoteId}`);
    await expect(page.getByLabel("Betreff", { exact: true })).toHaveValue(SUBJECT, { timeout: 15_000 });

    await page.getByRole("button", { name: "Senden", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("An")).toHaveValue(CUSTOMER_EMAIL);
    await dialog.getByRole("button", { name: "Senden", exact: true }).click();

    await expect.poll(async () => {
      const { data } = await werkbank().from("quotes").select("status").eq("id", quoteId).single();
      return data?.status;
    }, { timeout: 30_000 }).toBe("sent");

    let html = "";
    await expect.poll(async () => {
      const { data } = await adminClient()
        .from("demo_captured_sends")
        .select("preview_html, to_label")
        .eq("org_id", orgId)
        .eq("to_label", CUSTOMER_EMAIL);
      html = (data ?? []).map((r) => r.preview_html ?? "").join("\n");
      return /\/quote\/[0-9a-f]{64}/.test(html);
    }, { timeout: 30_000 }).toBe(true);
    token = /\/quote\/([0-9a-f]{64})/.exec(html)![1];

    await signOut(page);
  });

  test("the customer accepts the quote online with a typed signature", async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    const context = await browser.newContext({ baseURL, locale: "de-DE" });
    const page = await context.newPage();
    await seedConsent(page);
    try {
      await page.goto(`/quote/${token}`);
      await expect(page.getByRole("heading", { name: /^Angebot A-/ })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(TITLE_LINE)).toBeVisible();
      await expect(page.getByText(CATALOG_ITEM)).toBeVisible();
      await expect(page.getByText(TEXT_LINE)).toBeVisible();

      await page.getByLabel("Ihr vollständiger Name").first().fill(SIGNER);
      await page.getByRole("tab", { name: "Tippen" }).click();
      await page.locator("#sig-typed").fill(SIGNER);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Angebot verbindlich annehmen" }).click();
      await expect(page.getByRole("heading", { name: "Vielen Dank, das Angebot ist angenommen" })).toBeVisible({
        timeout: 30_000,
      });

      // A second visit shows the closed state instead of the form.
      await page.goto(`/quote/${token}`);
      await expect(page.getByText("Dieses Angebot wurde bereits angenommen")).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.close();
    }

    const { data: quote } = await werkbank().from("quotes").select("status").eq("id", quoteId).single();
    expect(quote?.status).toBe("accepted");
    const { data: acceptances } = await werkbank()
      .from("quote_acceptances")
      .select("decision, signer_name, method, typed_name")
      .eq("quote_id", quoteId);
    expect(acceptances).toEqual([{ decision: "accepted", signer_name: SIGNER, method: "typed", typed_name: SIGNER }]);
  });

  test("the admin sees the accepted quote and the notification", async ({ page }) => {
    const { data: notifications } = await adminClient()
      .from("notifications")
      .select("type, message")
      .eq("user_id", adminUserId)
      .eq("type", "quote_accepted");
    expect(notifications).toHaveLength(1);
    expect(notifications![0].message).toContain(SIGNER);

    await loginAsOrgAdmin(page);
    await page.goto("/quotes");
    const row = page.getByRole("row", { name: new RegExp(CUSTOMER) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Angenommen");
  });

  test("the admin creates the order, sets a date and a technician", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await page.goto(`/quotes/${quoteId}`);
    await page.getByRole("button", { name: "Auftrag anlegen" }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 15_000 });

    // The button is named by its <Label htmlFor>, not by its "Datum wählen" content.
    await page.getByRole("button", { name: "Datum", exact: true }).click();
    // DayPicker marks each day cell with data-day (ISO date) and neighbouring months with data-outside.
    await page.getByRole("grid").locator('[data-day$="-15"]:not([data-outside]) button').click();
    await page.getByLabel("Uhrzeit").fill("08:30");
    await page.getByLabel("Uhrzeit").blur();
    await page.getByRole("combobox", { name: "Monteure" }).click();
    await page.getByRole("option", { name: TECHNICIAN }).click();
    await page.keyboard.press("Escape");

    await expect.poll(async () => {
      const { data } = await werkbank().from("order_technicians").select("artist_id").eq("org_id", orgId);
      return (data ?? []).map((r) => r.artist_id);
    }, { timeout: 15_000 }).toEqual([technicianId]);

    const { data: orders } = await werkbank()
      .from("orders")
      .select("order_no, quote_id, scheduled_date, scheduled_time, status")
      .eq("org_id", orgId);
    expect(orders).toHaveLength(1);
    expect(orders![0]).toMatchObject({ quote_id: quoteId, status: "open", scheduled_time: "08:30:00" });
    expect(orders![0].order_no).toMatch(/^AU-/);
    expect(orders![0].scheduled_date).toBeTruthy();

    await navViaSidebar(page, /^aufträge$/i);
    const row = page.getByRole("row", { name: new RegExp(orders![0].order_no) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(TECHNICIAN);
    // The list shows the stored date and time (dd/MM/yyyy HH:mm) ...
    const [y, m, d] = orders![0].scheduled_date!.split("-");
    await expect(row).toContainText(`${d}/${m}/${y} 08:30`);
    // ... and the Nicht eingeplant filter leaves the scheduled order out.
    await page.getByRole("button", { name: "Nicht eingeplant" }).click();
    await expect(page.getByRole("button", { name: "Nicht eingeplant" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("row", { name: new RegExp(orders![0].order_no) })).toHaveCount(0);
  });
});
