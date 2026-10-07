/**
 * Werkbank foundation smoke: a super-admin creates a "Handwerksbetrieb" org in Platform,
 * its admin signs in and sees the Werkbank surface (brand, Monteure, none of the Showflow
 * booking navigation), the workspace type is locked, and a technician can be created and
 * invited. DB is the oracle for the org and its membership; the UI drives everything else.
 *
 * Runs in German: the client UI language follows the browser, and handwerk orgs have the
 * language package enabled by provisioning, so the German copy renders.
 */
import { expect, test, type Page } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { createConfirmedUser, deleteUserByEmail, ensurePlatformAdmin } from "./helpers/users";
import { navViaSidebar, signOut } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const stamp = Date.now();
const SUPER_EMAIL = tagEmail("werkbank-super", "fixed");
const SUPER_PASSWORD = "E2eWerkbankSuper!1";
const ADMIN_EMAIL = tagEmail("werkbank-admin", stamp);
const ADMIN_PASSWORD = "E2eWerkbankAdmin!1";
const TECHNICIAN_EMAIL = tagEmail("werkbank-monteur", stamp);
const TECHNICIAN_NAME = `Monteur ${stamp}`;
const ORG_SLUG = `e2e-werkbank-${stamp}`;
const ORG_NAME = "E2E Werkbank";

test.use({ locale: "de-DE" });

// The shared login helpers click an English "Sign in" button; the login page follows the
// browser language, so this spec signs in through the German label.
async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^(anmelden|sign in)$/i }).click();
}

async function loginAndAwaitDashboard(page: Page, email: string, password: string): Promise<void> {
  await login(page, email, password);
  await expect(page).toHaveURL(/\/(today|get-running)/, { timeout: 15_000 });
}
test.describe.configure({ mode: "serial" });

test.describe("Werkbank foundation", () => {
  let orgId = "";
  let adminUserId = "";

  test.beforeAll(async () => {
    await ensurePlatformAdmin(SUPER_EMAIL, SUPER_PASSWORD);
    await deleteUserByEmail(ADMIN_EMAIL);
    // Pre-created so provision-org takes the deterministic existing-user path (as in platform-console.spec.ts).
    adminUserId = (await createConfirmedUser(ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  });

  test.afterAll(async () => {
    const admin = adminClient();
    // Deleting the org cascades to its memberships, artists and invitations.
    await admin.from("organizations").delete().eq("slug", ORG_SLUG);
    await deleteUserByEmail(ADMIN_EMAIL);
    await deleteUserByEmail(TECHNICIAN_EMAIL);
  });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("super-admin creates a Handwerksbetrieb org and gives it an admin", async ({ page }) => {
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

    // Make the admin membership explicit (idempotent: provision-org may already have created it).
    const { error } = await admin
      .from("org_memberships")
      .upsert({ org_id: orgId, user_id: adminUserId, role: "admin" }, { onConflict: "org_id,user_id,role" });
    expect(error).toBeNull();
  });

  test("the org admin sees the Werkbank surface and none of the booking navigation", async ({ page }) => {
    await signOut(page);
    await loginAndAwaitDashboard(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Brand and kind-specific navigation.
    await expect(page.getByText("Werkbank Digital").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: /^monteure$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^einstellungen$/i })).toBeVisible();

    // The Showflow booking surface is hidden for this kind (German and English labels).
    const hidden = /^(termine|dates|einsätze|chats|loslegen|get running|verfügbarkeit|availability)(\s+\d+)?$/i;
    await expect(page.getByRole("link", { name: hidden })).toHaveCount(0);

    // The help center is offered to this kind again.
    await expect(page.getByRole("link", { name: /^(hilfe|help)$/i })).toBeVisible();

    // /dates is not a route for this kind: it redirects to the dashboard.
    await page.goto("/dates");
    await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
  });

  test("the workspace type is locked for the org admin", async ({ page }) => {
    await loginAndAwaitDashboard(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await navViaSidebar(page, /^einstellungen$/i);
    await page.getByRole("tab", { name: /^organisation\b/i }).click();

    const picker = page.getByLabel(/arbeitsbereich-typ/i);
    await expect(picker).toContainText("Handwerksbetrieb");
    await expect(picker).toBeDisabled();
  });

  test("the admin creates a technician, who is listed and invited", async ({ page }) => {
    await loginAndAwaitDashboard(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await navViaSidebar(page, /^monteure$/i);
    await expect(page).toHaveURL(/\/technicians/);

    await page.getByRole("button", { name: "Monteur anlegen", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(TECHNICIAN_NAME);
    await dialog.getByLabel("E-Mail").fill(TECHNICIAN_EMAIL);
    await dialog.getByRole("button", { name: "Anlegen und einladen" }).click();

    const row = page.getByRole("row", { name: new RegExp(TECHNICIAN_NAME) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // create-invitation links the login at invite time; the pill still reads "Eingeladen"
    // while the invitation is pending, and the row offers resend and revoke.
    await expect(row.getByText("Eingeladen")).toBeVisible();
    await expect(row.getByRole("button", { name: "Einladung erneut senden" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Einladung widerrufen" })).toBeVisible();

    // The DB agrees: exactly one pending artist invitation stamped with the new artist.
    const admin = adminClient();
    const { data: artist } = await admin
      .from("artists").select("id").eq("org_id", orgId).eq("email", TECHNICIAN_EMAIL).single();
    expect(artist?.id).toBeTruthy();
    const { data: invites } = await admin
      .from("org_invitations").select("role, status").eq("org_id", orgId).eq("artist_id", artist!.id);
    expect(invites).toEqual([{ role: "artist", status: "pending" }]);
  });
});
