import { describe, it, expect } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "@/components/layout/navItems";
import type { OrgKind } from "@/lib/orgKind";
import { MODULE_UIS } from "@/modules/ui";
import { werkbankUi } from "./ui";
import { WerkbankDashboard } from "./components/WerkbankDashboard";

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

  it("contributes the handwerk dashboard and no routes yet", () => {
    expect(werkbankUi.dashboards.handwerk).toBe(WerkbankDashboard);
    expect(werkbankUi.routes).toEqual([]);
  });
});
