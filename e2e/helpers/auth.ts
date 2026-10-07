/**
 * UI auth helpers for E2E tests. Use the email/password form on the login page —
 * Google OAuth is not scriptable in CI.
 *
 * The login form's `<label>` elements aren't associated with their inputs
 * (no `htmlFor`, no wrapping), so `getByLabel` can't find them. Target the
 * inputs by `type` instead.
 */
import { expect, type Page } from "@playwright/test";

/** The seeded account the committed `.env.development` auto-signs-in as on `npm run dev`. */
const DEV_AUTOLOGIN_EMAIL = "admin@example.com";

/**
 * Stop the local dev server's auto-login (`VITE_DEV_AUTOLOGIN` in the committed
 * `.env.development`, see src/features/auth/devAutoLogin.ts) from signing the
 * page in as the seeded admin. Call it before the first `page.goto` in any spec
 * that needs a signed-out page.
 *
 * Locally, Playwright drives `npm run dev`, so every fresh page boots, finds no
 * session and signs in as admin@example.com. CI serves a production build where
 * that path is stripped, so a spec that silently depends on being signed out
 * passes in CI and fails locally. Other password sign-ins (`loginAs`) still go
 * through, and in CI the route never matches, so this is a no-op there.
 */
export async function blockDevAutoLogin(page: Page): Promise<void> {
  await page.route("**/auth/v1/token?grant_type=password", async (route) => {
    const body = route.request().postDataJSON() as { email?: string };
    if (body.email === DEV_AUTOLOGIN_EMAIL) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "dev auto-login disabled for a signed-out e2e page" }),
      });
    } else {
      await route.continue();
    }
  });
}

export async function loginAs(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

export async function loginAsAndAwaitDashboard(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await loginAs(page, email, password);
  // Post-login lands at '/' (HomeLanding), which then decides: an artist and a
  // fully-set-up org go to /dashboard, while a non-artist whose Get running board
  // still has open setup tasks lands on /get-running. Accept either landed route
  // (never /login and never the transient '/') — callers that need a specific page
  // navigate there via the sidebar afterwards.
  await expect(page).toHaveURL(/\/(today|get-running)/, { timeout: 15_000 });
}

/**
 * Navigate to a role-gated route by clicking its sidebar link. `AuthContext`
 * fetches roles asynchronously after `loading` flips to false, so a direct
 * `page.goto` can race the role load and `ProtectedRoute` will bounce you
 * back to /dashboard. Waiting for the sidebar link to appear is a clean
 * proof-of-roles signal.
 */
export async function navViaSidebar(page: Page, linkName: RegExp): Promise<void> {
  // Nav links grow a numeric badge once useNavCounts resolves — the accessible
  // name flips from e.g. "Shows & Bookings" to "Shows & Bookings 1". An
  // end-anchored pattern that matched during the visibility check can stop
  // matching by the time click() re-resolves the locator, which then waits out
  // the whole test timeout for a name that never comes back (chronic CI flake;
  // the failure screenshot shows the link visible WITH its badge). Tolerate an
  // optional trailing count so both states match.
  const namePattern = new RegExp(
    linkName.source.replace(/\$$/, String.raw`(\s+\d+)?$`),
    linkName.flags,
  );
  const link = page.getByRole("link", { name: namePattern });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
}

export async function signOut(page: Page): Promise<void> {
  // Sign out is in the avatar menu in AppLayout; if not present, clear session via storage.
  await page.context().clearCookies();
  await page.goto("/login");
}
