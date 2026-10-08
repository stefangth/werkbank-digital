import type { ReactNode } from "react";
import { HardHat } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsTechnicianHere } from "../hooks/useAssignments";

/** Renders its children only when the signed-in user is a technician of the active org.
 *  Office roles pass the route guard, so this is the check that the app is for technicians. */
export function TechnicianRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation("werkbank");
  const isTechnician = useIsTechnicianHere();
  if (isTechnician === undefined) return <Skeleton role="status" aria-busy="true" className="h-40 w-full" />;
  if (!isTechnician) {
    return <EmptyState icon={HardHat} title={t("app.notTechnician")} body={t("app.notTechnicianReason")} reason={t("app.notTechnicianReason")} />;
  }
  return <>{children}</>;
}
