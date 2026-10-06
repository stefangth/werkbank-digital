import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/features/auth/AuthContext";

/** Landing page of a handwerk org. Office roles get the first next step; technicians
 *  see the welcome only. */
export function WerkbankDashboard() {
  const { t } = useTranslation("werkbank");
  const { hasRole } = useAuth();
  const canManage = hasRole("admin") || hasRole("producer");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("dashboard.title")}
        sub={t("dashboard.body")}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/technicians">{t("dashboard.cta")}</Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
