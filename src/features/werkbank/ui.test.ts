import { describe, it, expect } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "@/components/layout/navItems";
import type { OrgKind } from "@/lib/orgKind";
import { MODULE_UIS } from "@/modules/ui";
import {
  loadCatalogPage, loadCustomerDetailPage, loadCustomersPage, loadPropertiesPage, loadPropertyDetailPage, loadTechniciansPage, loadWerkbankDashboard, werkbankUi } from "./ui";
import { WerkbankDashboard } from "./components/WerkbankDashboard";
import { CatalogPage } from "./pages/CatalogPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { CustomersPage } from "./pages/CustomersPage";
import { TechniciansPage } from "./pages/TechniciansPage";
import { PropertiesPage } from "./pages/PropertiesPage";
import { PropertyDetailPage } from "./pages/PropertyDetailPage";
import { CATALOG_PATH, CUSTOMERS_PATH, PROPERTIES_PATH, TECHNICIANS_PATH } from "./paths";

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

  it("shows an admin of a handwerk org Dashboard, Customers, Services, Technicians, Settings", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx(["admin"], "handwerk")).map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Customers", "Properties", "Services", "Technicians", "Settings"]);
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

  it("contributes the catalog route for handwerk office roles", () => {
    const route = werkbankUi.routes.find((r) => r.path === CATALOG_PATH);
    expect(route?.path).toBe("/catalog");
    expect(route?.kinds).toEqual(["handwerk"]);
    expect(route?.requiredRoles).toEqual(["admin", "producer"]);
    expect(isLazy(route?.Page)).toBe(true);
  });

  it("contributes the customers route for handwerk office roles", () => {
    for (const path of [CUSTOMERS_PATH, "/customers/:id"]) {
      const route = werkbankUi.routes.find((r) => r.path === path);
      expect(route?.path).toBe(path);
      expect(route?.kinds).toEqual(["handwerk"]);
      expect(route?.requiredRoles).toEqual(["admin", "producer"]);
      expect(isLazy(route?.Page)).toBe(true);
    }
  });

  it("lists Customers first in the Werkbank group and hides it from artists and other kinds", () => {
    expect(werkbankUi.navItems[0].to).toBe(CUSTOMERS_PATH);
    expect(visibleNavItems(NAV_ITEMS, ctx(["producer"], "handwerk")).map((i) => i.label)).toContain("Customers");
    expect(visibleNavItems(NAV_ITEMS, ctx(["artist"], "handwerk")).map((i) => i.label)).not.toContain("Customers");
    expect(visibleNavItems(NAV_ITEMS, ctx(["admin"], "production")).map((i) => i.label)).not.toContain("Customers");
  });

  it("contributes the properties list and detail routes for handwerk office roles", () => {
    for (const path of [PROPERTIES_PATH, "/properties/:id"]) {
      const route = werkbankUi.routes.find((r) => r.path === path);
      expect(route?.kinds).toEqual(["handwerk"]);
      expect(route?.requiredRoles).toEqual(["admin", "producer"]);
      expect(isLazy(route?.Page)).toBe(true);
    }
  });

  it("lists Properties right after Customers and hides it from artists and other kinds", () => {
    expect(werkbankUi.navItems[1].to).toBe(PROPERTIES_PATH);
    expect(visibleNavItems(NAV_ITEMS, ctx(["producer"], "handwerk")).map((i) => i.label)).toContain("Properties");
    expect(visibleNavItems(NAV_ITEMS, ctx(["artist"], "handwerk")).map((i) => i.label)).not.toContain("Properties");
    expect(visibleNavItems(NAV_ITEMS, ctx(["admin"], "production")).map((i) => i.label)).not.toContain("Properties");
  });

  it("loads the properties pages lazily", async () => {
    expect((await loadPropertiesPage()).default).toBe(PropertiesPage);
    expect((await loadPropertyDetailPage()).default).toBe(PropertyDetailPage);
  });

  it("loads the customers page lazily", async () => {
    expect((await loadCustomersPage()).default).toBe(CustomersPage);
    expect((await loadCustomerDetailPage()).default).toBe(CustomerDetailPage);
  });

  it("shows Services to a producer of a handwerk org and hides it from artists and other kinds", () => {
    expect(visibleNavItems(NAV_ITEMS, ctx(["producer"], "handwerk")).map((i) => i.label)).toContain("Services");
    expect(visibleNavItems(NAV_ITEMS, ctx(["artist"], "handwerk")).map((i) => i.label)).not.toContain("Services");
    expect(visibleNavItems(NAV_ITEMS, ctx(["admin"], "production")).map((i) => i.label)).not.toContain("Services");
  });

  it("loads the catalog page lazily", async () => {
    expect((await loadCatalogPage()).default).toBe(CatalogPage);
  });

  it("loads the technicians page lazily, so it stays out of the main bundle", async () => {
    expect((await loadTechniciansPage()).default).toBe(TechniciansPage);
  });

  it("points the nav item at the same path as the route", () => {
    expect(werkbankUi.navItems.map((i) => i.to)).toEqual([CUSTOMERS_PATH, PROPERTIES_PATH, CATALOG_PATH, TECHNICIANS_PATH]);
  });
});
