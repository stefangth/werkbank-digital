/**
 * Werkbank master data smoke: a Handwerksbetrieb admin creates a Hausverwaltung, adds a property
 * billed to a different recipient, gives it a primary contact, prices a catalog item and imports
 * customers from a CSV. The werkbank schema (service role) is the oracle for the counts; the UI
 * drives everything else.
 *
 * Runs in German: the client UI language follows the browser, and handwerk orgs have the
 * language package enabled by provisioning, so the German copy renders.
 */
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { createConfirmedUser, deleteUserByEmail, ensurePlatformAdmin } from "./helpers/users";
import { navViaSidebar, signOut } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const stamp = Date.now();
const SUPER_EMAIL = tagEmail("werkbank-super", "fixed");
const SUPER_PASSWORD = "E2eWerkbankSuper!1";
const ADMIN_EMAIL = tagEmail("werkbank-sd-admin", stamp);
const ADMIN_PASSWORD = "E2eWerkbankAdmin!1";
const ORG_SLUG = `e2e-werkbank-sd-${stamp}`;
const ORG_NAME = "E2E Werkbank Stammdaten";
const CSV_FIXTURE = path.join(process.cwd(), "e2e", "fixtures", "werkbank-kunden.csv");

const CUSTOMER = "Hausverwaltung Müller";
const PROPERTY = "WEG Musterstr. 5";
const CATALOG_ITEM = "Stundensatz Monteur";

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
  await expect(page).toHaveURL(/\/(today|get-running)/, { timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Werkbank master data", () => {
  let orgId = "";
  let adminUserId = "";

  const werkbank = () => adminClient().schema("werkbank");

  test.beforeAll(async () => {
    await ensurePlatformAdmin(SUPER_EMAIL, SUPER_PASSWORD);
    await deleteUserByEmail(ADMIN_EMAIL);
    adminUserId = (await createConfirmedUser(ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  });

  test.afterAll(async () => {
    // Deleting the org cascades to its memberships and to the werkbank master data.
    await adminClient().from("organizations").delete().eq("slug", ORG_SLUG);
    await deleteUserByEmail(ADMIN_EMAIL);
  });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("setup: a Handwerksbetrieb org with an admin", async ({ page }) => {
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
    await signOut(page);
  });

  test("the admin creates a Hausverwaltung and gets a customer number", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await navViaSidebar(page, /^kunden$/i);
    await expect(page).toHaveURL(/\/customers/);

    await page.getByRole("button", { name: "Kunde anlegen", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Hausverwaltung" }).click();
    await dialog.getByLabel("Firmenname").fill(CUSTOMER);
    await dialog.getByLabel("Straße und Hausnummer").fill("Rathausplatz 1");
    await dialog.getByLabel("PLZ").fill("20095");
    await dialog.getByLabel("Ort").fill("Hamburg");
    await dialog.getByRole("button", { name: "Speichern" }).click();

    const row = page.getByRole("row", { name: new RegExp(CUSTOMER) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByRole("cell").first()).toHaveText(/^K-/);

    const { data: customers } = await werkbank().from("customers").select("customer_no, kind").eq("org_id", orgId);
    expect(customers).toHaveLength(1);
    expect(customers![0].kind).toBe("property_manager");
    expect(customers![0].customer_no).toMatch(/^K-/);
  });

  test("a property with a different billing recipient shows who the customer represents", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await navViaSidebar(page, /^kunden$/i);
    await page.getByRole("row", { name: new RegExp(CUSTOMER) }).click();
    await expect(page.getByRole("heading", { name: CUSTOMER })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Liegenschaft anlegen", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name der Liegenschaft").fill(PROPERTY);
    // Filled before the billing block opens: it repeats the street, PLZ and Ort labels.
    await dialog.getByLabel("Straße und Hausnummer").fill("Musterstr. 5");
    await dialog.getByLabel("PLZ").fill("20099");
    await dialog.getByLabel("Ort").fill("Hamburg");
    await dialog.getByRole("checkbox", { name: "Abweichender Rechnungsempfänger" }).click();
    await dialog.getByLabel("Name des Rechnungsempfängers").fill(PROPERTY);
    await dialog.getByLabel("Straße und Hausnummer").last().fill("Musterstr. 5");
    await dialog.getByLabel("PLZ").last().fill("20099");
    await dialog.getByLabel("Ort").last().fill("Hamburg");
    await dialog.getByRole("button", { name: "Speichern" }).click();

    await page.getByRole("link", { name: PROPERTY }).click();
    await expect(page.getByText("Rechnung geht an")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`${PROPERTY}, vertreten durch ${CUSTOMER}`)).toBeVisible();

    const { data: props } = await werkbank().from("properties").select("name, billing_name").eq("org_id", orgId);
    expect(props).toEqual([{ name: PROPERTY, billing_name: PROPERTY }]);
  });

  test("the property gets a primary contact", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await navViaSidebar(page, /^liegenschaften$/i);
    await page.getByRole("link", { name: PROPERTY }).click();
    await expect(page.getByText("Rechnung geht an")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Ansprechpartner anlegen", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Vorname (optional)").fill("Hausmeister");
    await dialog.getByLabel("Nachname").fill("Schulz");
    await dialog.getByRole("checkbox", { name: "Hauptansprechpartner" }).click();
    await dialog.getByRole("button", { name: "Speichern" }).click();

    const item = page.getByRole("listitem").filter({ hasText: "Hausmeister Schulz" });
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item.getByText("Hauptansprechpartner")).toBeVisible();

    const { data: contacts } = await werkbank()
      .from("contacts").select("last_name, is_primary, property_id").eq("org_id", orgId);
    expect(contacts).toHaveLength(1);
    expect(contacts![0]).toMatchObject({ last_name: "Schulz", is_primary: true });
    expect(contacts![0].property_id).toBeTruthy();
  });

  test("a catalog item shows its price in euros", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await navViaSidebar(page, /^leistungen$/i);

    await page.getByRole("button", { name: "Leistung anlegen", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Bezeichnung").fill(CATALOG_ITEM);
    await dialog.getByRole("combobox", { name: "Einheit" }).click();
    await page.getByRole("option", { name: "Std" }).click();
    await dialog.getByLabel("Lohn").fill("58");
    await dialog.getByLabel("Material").fill("0");
    await dialog.getByRole("combobox", { name: "MwSt." }).click();
    await page.getByRole("option", { name: "19 %" }).click();
    await dialog.getByRole("button", { name: "Speichern" }).click();

    const row = page.getByRole("row", { name: new RegExp(CATALOG_ITEM) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("58,00 €");

    const { data: items } = await werkbank()
      .from("catalog_items").select("unit_code, labour_price, material_price, vat_rate").eq("org_id", orgId);
    expect(items).toHaveLength(1);
    expect(items![0].unit_code).toBe("HUR");
    expect(Number(items![0].labour_price)).toBe(58);
    expect(Number(items![0].material_price)).toBe(0);
    expect(Number(items![0].vat_rate)).toBe(19);
  });

  test("a CSV import creates the valid customers and reports the invalid row", async ({ page }) => {
    await loginAsOrgAdmin(page);
    await navViaSidebar(page, /^kunden$/i);

    await page.getByRole("button", { name: "Importieren", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Datei auswählen").setInputFiles(CSV_FIXTURE);
    await dialog.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(dialog.getByText(/2 Zeilen sind bereit/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/1 Zeile hat Fehler/)).toBeVisible();
    await dialog.getByRole("button", { name: "2 Zeilen importieren" }).click();

    await expect(dialog.getByText("2 importiert, 0 übersprungen, 1 Fehler")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("list", { name: "Nicht importierte Zeilen" }).getByRole("listitem")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Fertig" }).click();

    await expect(page.getByRole("row", { name: /Hausverwaltung Nord/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("row", { name: /Meier, Anna/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Hausverwaltung Süd/ })).toHaveCount(0);

    const { count } = await werkbank().from("customers").select("id", { count: "exact", head: true }).eq("org_id", orgId);
    expect(count).toBe(3);
  });
});
