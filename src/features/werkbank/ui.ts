// Werkbank plugin UI: nav item, the technicians route and the handwerk dashboard,
// registered in src/modules/ui.ts. The pages load lazily so they ship in their own chunk
// instead of the main bundle every Showflow user downloads; the core renders module
// pages and dashboards inside Suspense (SuspendedPage).
import { lazy } from "react";
import { HardHat, Wrench } from "lucide-react";
import type { ModuleUi } from "@/modules/ui";
import { CATALOG_PATH, TECHNICIANS_PATH } from "./paths";

export const loadTechniciansPage = () =>
  import("./pages/TechniciansPage").then((m) => ({ default: m.TechniciansPage }));
export const loadWerkbankDashboard = () =>
  import("./components/WerkbankDashboard").then((m) => ({ default: m.WerkbankDashboard }));

export const loadCatalogPage = () =>
  import("./pages/CatalogPage").then((m) => ({ default: m.CatalogPage }));

const CatalogPage = lazy(loadCatalogPage);
const TechniciansPage = lazy(loadTechniciansPage);
const WerkbankDashboard = lazy(loadWerkbankDashboard);

export const werkbankUi: ModuleUi = {
  navItems: [
    {
      to: CATALOG_PATH,
      icon: Wrench,
      label: "Services",
      labelKey: "werkbank:nav.catalog",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
    {
      to: TECHNICIANS_PATH,
      icon: HardHat,
      label: "Technicians",
      labelKey: "werkbank:nav.technicians",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
  ],
  routes: [
    {
      path: CATALOG_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: CatalogPage,
    },
    {
      path: TECHNICIANS_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: TechniciansPage,
    },
  ],
  dashboards: { handwerk: WerkbankDashboard },
};
