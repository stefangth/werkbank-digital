import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvoice } from "../hooks/useInvoices";

/** The invoice page. Task 15 replaces the body; for now it shows the header. */
export function InvoicePage() {
  const { t } = useTranslation("werkbank");
  const { id } = useParams();
  const { data: invoice, isLoading, isError } = useInvoice(id);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError || !invoice) return <Alert variant="destructive">{t("invoices.page.loadFailed")}</Alert>;
  return (
    <PageHeader
      title={invoice.invoice_no ?? t("invoices.draftNumber")}
      sub={invoice.subject ?? undefined}
    />
  );
}
