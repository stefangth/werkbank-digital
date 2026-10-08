import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/AuthContext";
import { useStartList } from "../hooks/useStartList";
import { CATALOG_PATH, COMPANY_SETTINGS_PATH, CUSTOMERS_PATH, INVOICES_PATH, OPEN_ITEMS_PATH, TECHNICIANS_PATH } from "../paths";

/** The first-steps list on the handwerk dashboard: a step counts as done once at least one
 *  row exists (and then shows how many) or, for the company step, once the profile is complete. */
export function StartList({ orgId }: { orgId: string | undefined }) {
  const { t } = useTranslation("werkbank");
  const { data, isLoading, isError } = useStartList(orgId);
  const isAdmin = useAuth().hasRole("admin");

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !data) return <p className="text-sm text-destructive">{t("dashboard.startList.loadFailed")}</p>;

  // The company profile is admin-only to edit, so a producer is not sent to a page they cannot save.
  const steps = [
    ...(isAdmin ? [{ key: "company", to: COMPANY_SETTINGS_PATH, count: data.companyComplete ? 1 : 0, showCount: false }] : []),
    { key: "technicians", to: TECHNICIANS_PATH, count: data.technicians, showCount: true },
    { key: "catalog", to: CATALOG_PATH, count: data.catalogItems, showCount: true },
    { key: "customers", to: CUSTOMERS_PATH, count: data.customers, showCount: true },
    { key: "invoice", to: INVOICES_PATH, count: data.invoices, showCount: true },
    { key: "first_payment", to: OPEN_ITEMS_PATH, count: data.payments, showCount: false },
  ];

  return (
    <section aria-labelledby="start-list-title" className="space-y-3">
      <h2 id="start-list-title" className="text-lg font-semibold">
        {t("dashboard.startList.title")}
      </h2>
      <ol className="divide-y rounded-card border bg-card">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-3 p-4">
            {step.count > 0 ? (
              <span
                data-testid="step-done"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <Check className="h-4 w-4" aria-hidden />
              </span>
            ) : (
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground"
              >
                {i + 1}
              </span>
            )}
            <Link to={step.to} className="flex-1 font-medium hover:underline">
              {t(`dashboard.startList.${step.key}`)}
            </Link>
            {step.showCount && step.count > 0 && <span className="text-sm text-muted-foreground">{step.count}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
