/**
 * Werkbank technician app smoke (Teil 6a): a technician signs in on a phone-sized viewport, lands on
 * /einsaetze, opens today's order, starts it, writes a visit report with one photo, has it signed
 * with a drawn stroke and a name and reports the order done. The office then sees the notification,
 * the signed report on the order and downloads the report PDF. The werkbank schema (service role)
 * is the oracle.
 *
 * Needs the edge function for the PDF: `supabase functions serve` next to the local stack. Runs in German.
 */
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { blockDevAutoLogin } from "./helpers/auth";
import { createConfirmedUser, deleteUserByEmail, ensurePlatformAdmin } from "./helpers/users";
import { seedConsent } from "./helpers/consent";

const stamp = Date.now();
const SUPER_EMAIL = tagEmail("werkbank-super", "fixed");
const SUPER_PASSWORD = "E2eWerkbankSuper!1";
const ADMIN_EMAIL = tagEmail("werkbank-tech-admin", stamp);
const ADMIN_PASSWORD = "E2eWerkbankAdmin!1";
const TECH_EMAIL = tagEmail("werkbank-tech-monteur", stamp);
const TECH_PASSWORD = "E2eWerkbankMonteur!1";
const ORG_SLUG = `e2e-werkbank-tech-${stamp}`;
const ORG_NAME = "E2E Werkbank Monteure";

const CUSTOMER = "Hausverwaltung Einsatz";
const TECHNICIAN = "Max Monteur";
const ORDER_NO = "AU-E2E01";
const REPORT_TEXT = "Heizkörper entlüftet und Ventil getauscht.";
const SIGNER = "Erika Mieterin";
const PHOTO = path.join(process.cwd(), "e2e", "fixtures", "werkbank-photo.jpg");

test.use({ locale: "de-DE" });

// The shared login helpers click an English "Sign in" button; this spec signs in through the German label.
async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^(anmelden|sign in)$/i }).click();
}

/** Berlin calendar date as yyyy-mm-dd, the day the order must be scheduled for to land in "Heute". */
function berlinToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}

test.describe.configure({ mode: "serial" });

test.describe("Werkbank technician app", () => {
  let orgId = "";
  let adminUserId = "";
  let techUserId = "";
  let orderId = "";

  const werkbank = () => adminClient().schema("werkbank");

  test.beforeAll(async () => {
    await ensurePlatformAdmin(SUPER_EMAIL, SUPER_PASSWORD);
    await deleteUserByEmail(ADMIN_EMAIL);
    await deleteUserByEmail(TECH_EMAIL);
    adminUserId = (await createConfirmedUser(ADMIN_EMAIL, ADMIN_PASSWORD)).id;
    techUserId = (await createConfirmedUser(TECH_EMAIL, TECH_PASSWORD)).id;
  });

  test.afterAll(async () => {
    await adminClient().from("organizations").delete().eq("slug", ORG_SLUG);
    await deleteUserByEmail(ADMIN_EMAIL);
    await deleteUserByEmail(TECH_EMAIL);
  });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("setup: a Handwerksbetrieb org with an admin, a technician, a company profile and today's order", async ({ page }) => {
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

    const memberships = await admin.from("org_memberships").upsert([
      { org_id: orgId, user_id: adminUserId, role: "admin" },
      { org_id: orgId, user_id: techUserId, role: "artist" },
    ], { onConflict: "org_id,user_id,role" });
    expect(memberships.error).toBeNull();

    const tech = await admin
      .from("artists")
      .insert({ org_id: orgId, name: TECHNICIAN, email: TECH_EMAIL, user_id: techUserId, status: "active" })
      .select("id")
      .single();
    expect(tech.error).toBeNull();

    const customer = await werkbank()
      .from("customers")
      .insert({
        org_id: orgId, customer_no: "K-90010", kind: "property_manager", company_name: CUSTOMER,
        street: "Rathausplatz 1", postal_code: "20095", city: "Hamburg",
      })
      .select("id")
      .single();
    expect(customer.error).toBeNull();

    const profile = await werkbank().from("company_profiles").insert({
      org_id: orgId, company_name: "Muster Haustechnik GmbH", street: "Werkstattweg 3", postal_code: "20097",
      city: "Hamburg", email: "info@muster-haustechnik.example", tax_number: "201/123/45678",
    });
    expect(profile.error).toBeNull();

    const order = await werkbank()
      .from("orders")
      .insert({
        org_id: orgId, order_no: ORDER_NO, customer_id: customer.data!.id, subject: "Heizung entlüften",
        status: "open", scheduled_date: berlinToday(),
      })
      .select("id")
      .single();
    expect(order.error).toBeNull();
    orderId = order.data!.id;

    const assigned = await werkbank().from("order_technicians").insert({ org_id: orgId, order_id: orderId, artist_id: tech.data!.id });
    expect(assigned.error).toBeNull();
  });

  test("the technician starts the order, writes a report with a photo, gets it signed and reports it done", async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL, locale: "de-DE", viewport: { width: 390, height: 844 }, hasTouch: true,
    });
    const page = await context.newPage();
    await seedConsent(page);
    await blockDevAutoLogin(page);
    try {
      await login(page, TECH_EMAIL, TECH_PASSWORD);
      await expect(page).toHaveURL(/\/einsaetze$/, { timeout: 15_000 });
      await expect(page.getByRole("heading", { name: "Heute" })).toBeVisible({ timeout: 15_000 });
      await page.getByText(ORDER_NO).first().click();
      await expect(page).toHaveURL(new RegExp(`/einsaetze/${orderId}`), { timeout: 15_000 });

      await page.getByRole("button", { name: "Arbeit beginnen" }).click();
      await expect.poll(async () => (await werkbank().from("orders").select("status").eq("id", orderId).single()).data?.status, { timeout: 15_000 })
        .toBe("in_progress");

      await page.getByRole("button", { name: "Neuer Bericht" }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByText("Einsatzbericht", { exact: true })).toBeVisible({ timeout: 15_000 });
      await sheet.getByLabel("Was wurde gemacht").fill(REPORT_TEXT);

      await sheet.locator('input[type="file"]').setInputFiles(PHOTO);
      await expect.poll(async () => {
        const { data } = await werkbank().from("visit_report_photos").select("id").eq("org_id", orgId);
        return data?.length;
      }, { timeout: 30_000 }).toBe(1);

      await sheet.getByRole("button", { name: "Unterschreiben lassen" }).click();
      await sheet.getByLabel("Name der unterschreibenden Person").fill(SIGNER);
      const pad = sheet.getByRole("img", { name: "Unterschriftsfeld" });
      await pad.scrollIntoViewIfNeeded();
      const box = (await pad.boundingBox())!;
      await page.mouse.move(box.x + 30, box.y + 120);
      await page.mouse.down();
      await page.mouse.move(box.x + 90, box.y + 50, { steps: 8 });
      await page.mouse.move(box.x + 150, box.y + 130, { steps: 8 });
      await page.mouse.move(box.x + 220, box.y + 60, { steps: 8 });
      await page.mouse.up();
      await sheet.getByRole("button", { name: "Unterschreiben", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Unterschreiben", exact: true }).click();

      await expect.poll(async () => {
        const { data } = await werkbank().from("visit_reports").select("signer_name, signature_path, signed_at, body").eq("org_id", orgId);
        return data?.[0];
      }, { timeout: 30_000 }).toMatchObject({ signer_name: SIGNER, body: REPORT_TEXT, signature_path: expect.stringMatching(/signature\.png$/) });

      // The sheet closes after signing; the order page lists the report as signed.
      await expect(page.getByText(`Unterschrieben von ${SIGNER}`)).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Als erledigt melden" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Als erledigt melden" }).click();
      await expect.poll(async () => (await werkbank().from("orders").select("status").eq("id", orderId).single()).data?.status, { timeout: 15_000 })
        .toBe("done");
    } finally {
      await context.close();
    }
  });

  test("the office gets the notification, sees the signed report and downloads the PDF", async ({ page }) => {
    const { data: notifications } = await adminClient()
      .from("notifications")
      .select("type, message")
      .eq("user_id", adminUserId)
      .eq("type", "werkbank_order_completed");
    expect(notifications).toHaveLength(1);
    expect(notifications![0].message).toContain(ORDER_NO);

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/(today|get-running|dashboard)/, { timeout: 15_000 });
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText("Einsatzberichte", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(REPORT_TEXT)).toBeVisible();
    await expect(page.getByText("unterschrieben", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: `Unterschrift von ${SIGNER}` })).toBeVisible({ timeout: 15_000 });

    const responsePromise = page.waitForResponse((r) => r.url().includes("/functions/v1/werkbank-reports"), { timeout: 60_000 });
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    await page.getByRole("menuitem", { name: "Alle Berichte" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
  });
});
