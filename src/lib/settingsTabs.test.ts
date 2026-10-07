import { describe, it, expect } from "vitest";
import type { OrgKind } from "./orgKind";
import { isSettingsTabAllowedForKind, resolveInitialTab, SETTINGS_TAB_KINDS, SETTINGS_TAB_PARAMS } from "./settingsTabs";

// A kind no core settings tab lists, standing in for a plugin kind.
const TEST_KIND = "test_kind" as OrgKind;

describe("resolveInitialTab", () => {
  it("honours a whitelisted tab param", () => {
    expect(resolveInitialTab("airtable", true)).toBe("airtable");
    expect(resolveInitialTab("airtable", false)).toBe("airtable");
  });

  it("docs deep-link falls back for a non-super-admin", () => {
    // Admin/producer fall back to "how this org works"; a plain member to "organization".
    expect(resolveInitialTab("docs", true, false)).toBe("how-it-works");
    expect(resolveInitialTab("docs", false, false)).toBe("organization");
  });

  it("docs deep-link opens for a super-admin", () => {
    expect(resolveInitialTab("docs", true, true)).toBe("docs");
  });

  it("lands on 'how this org works' for an admin or producer when no tab is asked for", () => {
    expect(resolveInitialTab(null, true)).toBe("how-it-works");
    // Producer is the 4th arg (isAdmin=false, isSuperAdmin=false, isProducer=true).
    expect(resolveInitialTab(null, false, false, true)).toBe("how-it-works");
  });

  it("lands on 'organization' for a member who cannot see 'how this org works'", () => {
    expect(resolveInitialTab(null, false)).toBe("organization");
  });

  it("falls back to the role default on an unknown tab", () => {
    expect(resolveInitialTab("nope", true)).toBe("how-it-works");
    expect(resolveInitialTab("", false)).toBe("organization");
  });

  it("gives a non-admin the default rather than an admin-only tab they cannot see", () => {
    // "permissions" has no trigger and no content for a producer, so honouring the param
    // would strand them on an empty pane.
    expect(resolveInitialTab("permissions", false)).toBe("organization");
    expect(resolveInitialTab("permissions", true)).toBe("permissions");
  });

  it("gives a non-admin the default rather than the admin-only People/Activity tabs", () => {
    // Folded in from the retired standalone Admin page: same admin-only floor it always had.
    expect(resolveInitialTab("people", false)).toBe("organization");
    expect(resolveInitialTab("people", true)).toBe("people");
    expect(resolveInitialTab("activity", false)).toBe("organization");
    expect(resolveInitialTab("activity", true)).toBe("activity");
  });

  it("no longer deep-links the retired sync-log tab (duplicate of Airtable sync's history view)", () => {
    expect(resolveInitialTab("sync-log", true)).toBe("how-it-works");
    expect(SETTINGS_TAB_PARAMS).not.toContain("sync-log");
  });

  it("redirects the retired casts-cities and production-ownership params to casts-coverage", () => {
    // Both sections folded into Casts & coverage; an old bookmark or notification link
    // must still land somewhere valid rather than falling back to the role default.
    expect(resolveInitialTab("casts-cities", true)).toBe("casts-coverage");
    expect(resolveInitialTab("casts-cities", false)).toBe("casts-coverage");
    expect(resolveInitialTab("production-ownership", true)).toBe("casts-coverage");
    expect(resolveInitialTab("production-ownership", false)).toBe("casts-coverage");
  });

  it("deep-links the hire-orders tab (a safe target despite the entitlement gate)", () => {
    // hire-orders is entitlement-gated, but SettingsPage renders its trigger and content for
    // any admin/producer regardless of entitlement (HireOrdersTab self-gates on useFeature),
    // so a ?tab=hire-orders link is no worse than the tab an admin can already click by hand.
    // The /get-running contract-task breadcrumbs rely on this deep link.
    expect(resolveInitialTab("hire-orders", true)).toBe("hire-orders");
    expect(SETTINGS_TAB_PARAMS).toContain("hire-orders");
  });

  it("deep-links the get-running tab (the Phase 5 Settings mirror of the v3 board)", () => {
    // Whitelisting here just lets a deep link resolve to the value; SettingsPage renders
    // its "get-running" trigger/content for every admin/producer unconditionally.
    expect(SETTINGS_TAB_PARAMS).toContain("get-running");
    expect(resolveInitialTab("get-running", true, false, false)).toBe("get-running");
  });

  it("honours the get-running deep link for a super-admin too", () => {
    expect(resolveInitialTab("get-running", false, true, false)).toBe("get-running");
  });
});

describe("kind-aware settings tabs", () => {
  it("restricts the booking-specific tabs to production and staffing", () => {
    for (const tab of ["how-it-works", "get-running", "casts-coverage", "skills", "airtable", "booking", "hire-orders"] as const) {
      expect(SETTINGS_TAB_KINDS[tab]).toEqual(["production", "staffing"]);
    }
  });

  it("allows every tab for production and staffing, and the neutral tabs for any kind", () => {
    // "numbering" belongs to the handwerk plugin kind only (see its own test below).
    for (const tab of [...SETTINGS_TAB_PARAMS.filter((t) => t !== "numbering" && t !== "company"), "trust"]) {
      expect(isSettingsTabAllowedForKind(tab, "production")).toBe(true);
      expect(isSettingsTabAllowedForKind(tab, "staffing")).toBe(true);
    }
    for (const tab of ["organization", "permissions", "people", "activity", "email-templates", "notifications", "trust", "docs"]) {
      expect(isSettingsTabAllowedForKind(tab, TEST_KIND)).toBe(true);
    }
  });

  it("refuses the booking-specific tabs for another kind", () => {
    for (const tab of ["how-it-works", "get-running", "casts-coverage", "skills", "airtable", "booking", "hire-orders"]) {
      expect(isSettingsTabAllowedForKind(tab, TEST_KIND)).toBe(false);
    }
  });

  it("opens a tab the kind allows exactly as before", () => {
    expect(resolveInitialTab("booking", true, false, false, "production")).toBe("booking");
    expect(resolveInitialTab("booking", true, false, false, "staffing")).toBe("booking");
    expect(resolveInitialTab("notifications", true, false, false, TEST_KIND)).toBe("notifications");
  });

  it("falls back to 'organization' when the asked-for tab is not allowed for the kind", () => {
    expect(resolveInitialTab("booking", true, false, false, TEST_KIND)).toBe("organization");
    expect(resolveInitialTab("casts-cities", true, false, false, TEST_KIND)).toBe("organization");
    expect(resolveInitialTab("booking", false, false, true, TEST_KIND)).toBe("organization");
  });

  it("picks the default among allowed tabs: 'organization' when how-it-works is not allowed", () => {
    expect(resolveInitialTab(null, true, false, false, TEST_KIND)).toBe("organization");
    expect(resolveInitialTab(null, false, false, true, TEST_KIND)).toBe("organization");
    expect(resolveInitialTab("nope", true, false, false, TEST_KIND)).toBe("organization");
    expect(resolveInitialTab(null, true, false, false, "production")).toBe("how-it-works");
  });
});

// Whether each value in SETTINGS_TAB_PARAMS actually names a tab SettingsPage renders is
// not something this pure module can know, and asserting the list against a copy of itself
// would only restate it. That guard lives in SettingsPage.test.tsx, which renders the page
// once per value and checks a tab really gets selected.

describe("numbering tab", () => {
  it("is offered to handwerk only", () => {
    expect(SETTINGS_TAB_KINDS.numbering).toEqual(["handwerk"]);
    expect(isSettingsTabAllowedForKind("numbering", "handwerk")).toBe(true);
    expect(isSettingsTabAllowedForKind("numbering", "production")).toBe(false);
    expect(isSettingsTabAllowedForKind("numbering", "staffing")).toBe(false);
  });

  it("opens for a handwerk admin", () => {
    expect(resolveInitialTab("numbering", true, false, false, "handwerk")).toBe("numbering");
  });

  it("falls back to the default tab for a producer deep link", () => {
    expect(resolveInitialTab("numbering", false, false, true, "handwerk")).toBe("organization");
  });

  it("falls back for an admin of a production org", () => {
    expect(resolveInitialTab("numbering", true, false, false, "production")).toBe("how-it-works");
  });
});

describe("company tab", () => {
  it("is offered to handwerk admins only", () => {
    expect(SETTINGS_TAB_KINDS.company).toEqual(["handwerk"]);
    expect(isSettingsTabAllowedForKind("company", "handwerk")).toBe(true);
    expect(isSettingsTabAllowedForKind("company", "production")).toBe(false);
    expect(isSettingsTabAllowedForKind("company", "staffing")).toBe(false);
    expect(resolveInitialTab("company", true, false, false, "handwerk")).toBe("company");
  });

  it("falls back for a producer deep link and for a production org", () => {
    expect(resolveInitialTab("company", false, false, true, "handwerk")).toBe("organization");
    expect(resolveInitialTab("company", true, false, false, "production")).toBe("how-it-works");
  });
});
