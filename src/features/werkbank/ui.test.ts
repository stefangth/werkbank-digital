import { describe, it, expect } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "@/components/layout/navItems";
import type { OrgKind } from "@/lib/orgKind";
import { MODULE_UIS } from "@/modules/ui";
import { loadTechniciansPage, loadWerkbankDashboard, werkbankUi } from "./ui";
import { WerkbankDashboard } from "./components/WerkbankDashboard";
import { TechniciansPage } from "./pages/TechniciansPage";
import { TECHNICIANS_PATH } from "./paths";

const ctx = (roles: string[], orgKind: OrgKind) => ({
  isEditorMode: false,
  isRealAdmin: false,
  isSuperAdmin: false,
  hasRole: (r: string) => roles.includes(r),
  enabledFeatures: new Set<string>(),
  entitlementsLoading: false,
  impersonating: false,
  orgKind,
});

/** React.lazy components are tagged with this symbol. */
const isLazy = (component: unknown) =>
  typeof component === "object" && component !== null
  && (component as { $$typeof?: symbol }).$$typeof === Symbol.for("react.lazy");

describe("werkbank module UI", () => {
  it("is registered in the module UI manifest", () => {
    expect(MODULE_UIS).toContain(werkbankUi);
  });

  it("shows an admin of a handwerk org Dashboard, Technicians, Settings", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx(["admin"], "handwerk")).map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Technicians", "Settings"]);
  });

  it("hides Technicians from a handwerk artist", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx(["artist"], "handwerk")).map((i) => i.label);
    expect(labels).not.toContain("Technicians");
  });

  it("leaves the production nav unchanged", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx(["admin"], "production")).map((i) => i.label);
    expect(labels).not.toContain("Technicians");
    expect(labels).toEqual([
      "Get running", "Dashboard", "Dates", "Hire orders", "Chats", "Productions", "Artists", "Help", "Settings",
    ]);
  });

  it("contributes the handwerk dashboard, loaded lazily", async () => {
    expect(isLazy(werkbankUi.dashboards.handwerk)).toBe(true);
    expect((await loadWerkbankDashboard()).default).toBe(WerkbankDashboard);
  });

  it("contributes the technicians route for handwerk office roles", () => {
    const route = werkbankUi.routes.find((r) => r.path === TECHNICIANS_PATH);
    expect(route).toBeDefined();
    expect(route?.path).toBe("/technicians");
    expect(route?.kinds).toEqual(["handwerk"]);
    expect(route?.requiredRoles).toEqual(["admin", "producer"]);
    expect(isLazy(route?.Page)).toBe(true);
  });

  it("loads the technicians page lazily, so it stays out of the main bundle", async () => {
    expect((await loadTechniciansPage()).default).toBe(TechniciansPage);
  });

  it("points the nav item at the same path as the route", () => {
    expect(werkbankUi.navItems.map((i) => i.to)).toEqual([TECHNICIANS_PATH]);
  });
});
