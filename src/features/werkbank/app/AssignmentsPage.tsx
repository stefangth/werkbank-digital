import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state";
import { MobileShell } from "./MobileShell";
import { TechnicianRoute } from "./TechnicianRoute";

/** Placeholder until the list lands (technician app, list page). */
export function AssignmentsPage() {
  const { t } = useTranslation("werkbank");
  return (
    <MobileShell title={t("app.assignmentsTitle")}>
      <TechnicianRoute>
        <EmptyState icon={ClipboardList} title={t("app.assignmentsTitle")} reason={t("app.assignmentsTitle")} />
      </TechnicianRoute>
    </MobileShell>
  );
}
