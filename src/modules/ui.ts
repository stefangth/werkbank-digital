// Module UI manifest: navigation, routes and dashboards that plugins add on top of the core
// app. Empty in core. The core never names a module kind; each entry carries the kinds it
// belongs to. Kinds themselves come from src/modules/registry.ts.
// Type-only imports: navItems.ts and App.tsx import this file at runtime, and module pages
// will import from the app config, so nothing here may create a runtime cycle.
import type { ComponentType } from "react";
import type { NavItem } from "@/components/layout/navItems";
import type { AppRole } from "@/config/app.config";
import type { OrgKind } from "@/lib/orgKind";

/** A page a module adds. App.tsx wraps it in ProtectedRoute and AppLayout. The route is
 *  reachable only by the listed kinds (ProtectedRoute redirects everyone else). */
export interface ModuleRoute {
  path: string;
  kinds: readonly OrgKind[];
  requiredRoles: AppRole[];
  Page: ComponentType;
}

export interface ModuleUi {
  /** Appended to the sidebar before Help. Set `kinds` on each item to scope it. */
  navItems: NavItem[];
  routes: ModuleRoute[];
  /** The dashboard rendered at the dashboard route for a kind, replacing today's logic. */
  dashboards: Partial<Record<OrgKind, ComponentType>>;
}

export const MODULE_UIS: readonly ModuleUi[] = [];
