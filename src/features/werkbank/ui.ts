// Werkbank plugin UI: nav item, routes and the handwerk dashboard, registered in
// src/modules/ui.ts. Routes are added with the technicians page.
import { HardHat } from "lucide-react";
import type { ModuleUi } from "@/modules/ui";
import { WerkbankDashboard } from "./components/WerkbankDashboard";

export const werkbankUi: ModuleUi = {
  navItems: [
    {
      to: "/technicians",
      icon: HardHat,
      label: "Technicians",
      labelKey: "werkbank:nav.technicians",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
  ],
  routes: [],
  dashboards: { handwerk: WerkbankDashboard },
};
