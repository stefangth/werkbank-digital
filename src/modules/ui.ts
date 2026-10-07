// Module UI manifest: navigation, routes and dashboards that plugins add on top of the core
// app. Empty in core. The core never names a module kind; each entry carries the kinds it
// belongs to. Kinds themselves come from src/modules/registry.ts.
// navItems.ts and App.tsx import this file at runtime, and module pages import from the app
// config, so core types come in type-only and each plugin contributes one `<plugin>Ui` import.
import type { ComponentType } from "react";
import type { NavItem } from "@/components/layout/navItems";
import type { AppRole } from "@/config/app.config";
import type { OrgKind } from "@/lib/orgKind";
import { werkbankUi } from "@/features/werkbank/ui";

/** A page a module adds. App.tsx wraps it in ProtectedRoute and AppLayout. The route is
 *  reachable only by the listed kinds (ProtectedRoute redirects everyone else). */
export interface ModuleRoute {
  path: string;
  kinds: readonly OrgKind[];
  requiredRoles: AppRole[];
  Page: ComponentType;
}

/** A page a module serves to anyone, with no login and no app shell (e.g. a link sent to a
 *  customer). App.tsx renders it next to the other public pages, wrapped only in Suspense. */
export interface ModulePublicRoute {
  path: string;
  Page: ComponentType;
}

export interface ModuleUi {
  /** Appended to the sidebar before Help. Set `kinds` on each item to scope it. */
  navItems: NavItem[];
  routes: ModuleRoute[];
  /** Public pages: no ProtectedRoute, no AppLayout. */
  publicRoutes: ModulePublicRoute[];
  /** The dashboard rendered at the dashboard route for a kind, replacing today's logic. */
  dashboards: Partial<Record<OrgKind, ComponentType>>;
}

export const MODULE_UIS: readonly ModuleUi[] = [werkbankUi];
