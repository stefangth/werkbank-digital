import { useIsMutating } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import { formatDateDMY } from "@/lib/dates";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { DunningCard } from "../components/DunningCard";
import { DocumentTotalsCard } from "../components/DocumentTotalsCard";
import { InvoiceHeaderForm } from "../components/InvoiceHeaderForm";
import { InvoiceActions, PdfPendingNotice } from "../components/InvoiceActions";
import { InvoiceHistory } from "../components/InvoiceHistory";
import { IssueInvoiceDialog } from "../components/IssueInvoiceDialog";
import { LineItemsEditor } from "../components/LineItemsEditor";
import { PaymentsCard } from "../components/PaymentsCard";
import { refKey } from "../data/documentItems";
import type { InvoicePatch } from "../data/invoices";
import { useCustomer } from "../hooks/useCustomers";
import { usePreviewInvoice } from "../hooks/useInvoiceActions";
import { ITEMS_KEY } from "../hooks/useDocumentItems";
import { useCancellationOf, useInvoice, useInvoiceMutations } from "../hooks/useInvoices";
import { useOrder } from "../hooks/useOrders";
import { useProperty } from "../hooks/useProperties";
import { mapDbError } from "../lib/dbErrors";
import { customerDisplayName } from "../lib/displayName";
import { INVOICE_STATUS_TONES, type InvoiceStatus } from "../lib/invoiceStatus";
import { openPendingTab, pdfBlobUrl, showInTab } from "../lib/pdfTab";
import { INVOICES_PATH, invoicePath } from "../paths";

/** One invoice. A draft is edited in place (header, service period, payment term, items) and
 *  issued through the issue dialog, after which it can no longer change. Any other status is
 *  shown read only. A cancellation draft keeps customer, discount and items of the original. */
export function InvoicePage() {
  const { t } = useTranslation("werkbank");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: invoice, isLoading, isError, refetch } = useInvoice(id);
  const { data: original } = useInvoice(invoice?.cancels_invoice_id ?? undefined);
  const { data: customer } = useCustomer(invoice?.customer_id);
  const { data: property } = useProperty(invoice?.property_id ?? undefined);
  const { data: cancelledBy } = useCancellationOf(
    invoice?.id, invoice?.status === "cancelled" || (invoice?.status === "issued" && invoice.type === "invoice"));
  // R28: a draft invoice of an order can only be issued once the order is done.
  const { data: order } = useOrder(
    invoice?.status === "draft" && invoice.type === "invoice" ? invoice.order_id ?? undefined : undefined);
  const { update, remove } = useInvoiceMutations();
  // "Abschließen" waits for the last edit to be saved, so the PDF never misses it.
  const itemWrites = useIsMutating({ mutationKey: [...ITEMS_KEY, refKey({ invoiceId: id ?? "" })] });
  const preview = usePreviewInvoice();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [issuing, setIssuing] = useState(false);
  // Keyed by the invoice id: the route reuses this component, so a lock must not carry over.
  const [lockedId, setLockedId] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) return <Alert variant="destructive">{t("invoices.page.loadFailed")}</Alert>;
  // After a delete the refetch finds no invoice before the navigation runs: keep the skeleton.
  if (!invoice && (remove.isPending || remove.isSuccess)) return <Skeleton className="h-48 w-full" />;
  if (!invoice) {
    return (
      <div className="space-y-4">
        <EmptyState icon={Receipt} title={t("invoices.page.notFound.title")} reason={t("invoices.page.notFound.reason")} />
        <p className="text-center">
          <Link to={INVOICES_PATH} className="text-sm font-medium text-accent-text hover:underline">
            {t("invoices.page.notFound.back")}
          </Link>
        </p>
      </div>
    );
  }

  const isDraft = invoice.status === "draft";
  const isCancellation = invoice.type === "cancellation";
  const locked = lockedId === invoice.id;
  const editable = isDraft && !locked;
  const status = invoice.status as InvoiceStatus;
  const cancelled = invoice.status === "cancelled";
  const names = {
    customer: customer ? customerDisplayName(customer) : null,
    property: property?.name ?? null,
  };

  // A save that hits an invoice issued meanwhile: fetch the real state, so the page turns read only.
  const save = (patch: InvoicePatch) =>
    update.mutate(
      { id: invoice.id, patch },
      {
        onError: (e) => {
          if (mapDbError(e) === "errors.invoiceLocked") {
            setLockedId(invoice.id);
            void refetch();
          }
        },
      },
    );

  // The tab is opened inside the click, before the edge call, so the browser allows it.
  const showPreview = () => {
    const tab = openPendingTab();
    return preview.mutateAsync(invoice.id)
      .then((base64) =>
        showInTab(tab, pdfBlobUrl(base64), (url) =>
          toast.error(t("invoices.page.pdfBlocked"), { action: { label: t("invoices.page.pdfOpen"), onClick: () => window.open(url, "_blank") } })))
      .catch(() => {
        tab?.close();
        toast.error(t("invoices.page.pdfFailed"));
      });
  };

  return (
    <div className="space-y-6">
      <Link to={INVOICES_PATH} className="text-sm font-medium text-accent-text hover:underline">
        {t("invoices.page.back")}
      </Link>
      <PageHeader
        eyebrow={t("invoices.title")}
        title={isCancellation ? t("invoices.page.cancellationTitle") : invoice.subject ?? invoice.invoice_no ?? t("invoices.draftNumber")}
        actions={
          !isDraft ? (
            <InvoiceActions invoice={invoice} cancelledBy={cancelledBy} onStateChanged={() => void refetch()} />
          ) : editable && (
            <>
              <Button variant="secondary" disabled={preview.isPending} onClick={() => void showPreview()}>
                {t("invoices.page.preview")}
              </Button>
              <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>{t("invoices.page.delete")}</Button>
              <Button disabled={update.isPending || itemWrites > 0} onClick={() => setIssuing(true)}>{t("invoices.page.issue")}</Button>
            </>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        {invoice.invoice_no && <Token className="text-title-sm">{invoice.invoice_no}</Token>}
        <StatusPill tone={INVOICE_STATUS_TONES[status] ?? "neutral"}>{t(`invoices.status.${status}`)}</StatusPill>
        {isCancellation && <StatusPill tone="neutral">{t("invoices.type.cancellation")}</StatusPill>}
        {invoice.issue_date && <span>{t("invoices.header.issueDate")} <Metric size="body">{formatDateDMY(invoice.issue_date)}</Metric></span>}
        {invoice.due_date && <span>{t("invoices.header.dueDate")} <Metric size="body">{formatDateDMY(invoice.due_date)}</Metric></span>}
        {isCancellation && original && (
          <Link to={invoicePath(original.id)} className="text-sm font-medium text-accent-text hover:underline">
            {t("invoices.page.cancels", { number: original.invoice_no })}
          </Link>
        )}
      </div>

      {locked && <Alert variant="destructive">{t("errors.invoiceLocked")}</Alert>}
      {cancelled && cancelledBy && (
        <Alert>
          {t("invoices.page.cancelledBanner")}{" "}
          <Link to={invoicePath(cancelledBy.id)} className="font-medium text-accent-text hover:underline">
            <Token>{cancelledBy.invoice_no ?? t("invoices.draftNumber")}</Token>
          </Link>
        </Alert>
      )}
      {editable && !isCancellation && order && order.status !== "done" && (
        <Alert>{t("invoices.page.orderNotDone")}</Alert>
      )}
      {!isDraft && !invoice.pdf_path && (
        <PdfPendingNotice invoiceId={invoice.id} onDone={() => void refetch()} />
      )}

      <InvoiceHeaderForm key={`${invoice.id}-${editable}`} invoice={invoice} readOnly={!editable} names={names} onPatch={save} />

      <LineItemsEditor
        docRef={{ invoiceId: invoice.id }}
        readOnly={!editable || isCancellation}
        onLocked={() => { setLockedId(invoice.id); void refetch(); }}
      />
      <DocumentTotalsCard totals={invoice.totals} isPrivateCustomer={customer?.kind === "private"} negate={isCancellation} />
      {!isDraft && !isCancellation && <PaymentsCard invoiceId={invoice.id} customerId={invoice.customer_id} status={invoice.status} />}
      {!isDraft && !isCancellation && <DunningCard invoice={invoice} />}
      <InvoiceHistory invoice={invoice} cancelledBy={cancelledBy} />

      {issuing && isDraft && (
        <IssueInvoiceDialog invoice={invoice} mode="issue" open onOpenChange={setIssuing} onStateChanged={() => void refetch()} />
      )}
      <DeleteConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("invoices.page.deleteTitle")}
        body={t("invoices.page.deleteBody")}
        onConfirm={() => remove.mutate(invoice.id, { onSuccess: () => { setConfirmingDelete(false); navigate(INVOICES_PATH); } })}
        pending={remove.isPending}
      />
    </div>
  );
}
