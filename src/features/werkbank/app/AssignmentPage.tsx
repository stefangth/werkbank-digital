import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state";
import { ASSIGNMENTS_PATH } from "../paths";
import { MobileShell } from "./MobileShell";
import { TechnicianRoute } from "./TechnicianRoute";

/** Placeholder until the detail page lands (technician app, detail page). */
export function AssignmentPage() {
  const { t } = useTranslation("werkbank");
  return (
    <MobileShell title={t("app.assignmentTitle")} back={ASSIGNMENTS_PATH}>
      <TechnicianRoute>
        <EmptyState icon={ClipboardList} title={t("app.assignmentTitle")} reason={t("app.assignmentTitle")} />
      </TechnicianRoute>
    </MobileShell>
  );
}
