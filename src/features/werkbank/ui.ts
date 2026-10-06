// Werkbank plugin UI: nav item, the technicians route and the handwerk dashboard,
// registered in src/modules/ui.ts.
import { HardHat } from "lucide-react";
import type { ModuleUi } from "@/modules/ui";
import { WerkbankDashboard } from "./components/WerkbankDashboard";
import { TechniciansPage } from "./pages/TechniciansPage";
import { TECHNICIANS_PATH } from "./paths";

export const werkbankUi: ModuleUi = {
  navItems: [
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
      path: TECHNICIANS_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: TechniciansPage,
    },
  ],
  dashboards: { handwerk: WerkbankDashboard },
};
