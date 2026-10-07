import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/features/auth/AuthContext";
import { StartList } from "./StartList";

/** Landing page of a handwerk org. Office roles get the start list; technicians see the
 *  welcome only. */
export function WerkbankDashboard() {
  const { t } = useTranslation("werkbank");
  const { hasRole, currentOrg } = useAuth();
  const canManage = hasRole("admin") || hasRole("producer");

  return (
    <div className="space-y-6">
      <PageHeader title={t("dashboard.title")} sub={t("dashboard.body")} />
      {canManage && <StartList orgId={currentOrg?.id} />}
    </div>
  );
}
