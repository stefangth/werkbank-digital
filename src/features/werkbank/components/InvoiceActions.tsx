import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InvoiceActionError } from "../data/invoiceActions";
import type { Invoice } from "../data/invoices";
import { useInvoiceDownload, useIssueInvoice } from "../hooks/useInvoiceActions";
import { useInvoiceMutations } from "../hooks/useInvoices";
import { openPendingTab, showInTab } from "../lib/pdfTab";
import { invoicePath } from "../paths";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { IssueInvoiceDialog, type IssuableInvoice } from "./IssueInvoiceDialog";

type ActionInvoice = IssuableInvoice & Pick<Invoice, "status" | "pdf_path" | "sent_at">;

/** The buttons of an issued or cancelled invoice: the stored PDF, send (again), cancel with a
 *  confirmation, and copy (a cancelled original offers the corrected invoice instead). Cancel and
 *  copy navigate to the draft they create. A cancellation document can only be sent and downloaded. */
export function InvoiceActions({
  invoice, cancelledBy, onStateChanged,
}: {
  invoice: ActionInvoice;
  /** The cancellation document of this invoice, if one exists (draft or issued). */
  cancelledBy?: { id: string; invoice_no: string | null } | null;
  onStateChanged?: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const navigate = useNavigate();
  const download = useInvoiceDownload();
  const { cancel, copy } = useInvoiceMutations();
  const [sending, setSending] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const issued = invoice.status === "issued";
  const isInvoice = invoice.type === "invoice";
  const hasPdf = !!invoice.pdf_path;

  // The tab is opened inside the click, before the edge call, so the browser allows it.
  const openPdf = () => {
    const tab = openPendingTab();
    return download.mutateAsync(invoice.id)
      .then((url) =>
        showInTab(tab, url, (blocked) =>
          toast.error(t("invoices.page.pdfBlocked"), { action: { label: t("invoices.page.pdfOpen"), onClick: () => window.open(blocked, "_blank", "noopener") } })))
      .catch(() => {
        tab?.close();
        toast.error(t("invoices.page.pdfFailed"));
      });
  };

  const goToDraft = { onSuccess: (id: string) => navigate(invoicePath(id)) };

  return (
    <>
      {hasPdf && (
        <Button variant="secondary" disabled={download.isPending} onClick={() => void openPdf()}>
          {t("invoices.page.pdf")}
        </Button>
      )}
      {issued && hasPdf && (
        <Button variant="secondary" onClick={() => setSending(true)}>
          {t(invoice.sent_at ? "invoices.page.resend" : "invoices.page.send")}
        </Button>
      )}
      {issued && isInvoice && (
        <>
          <Button variant="secondary" onClick={() => copy.mutate(invoice.id, goToDraft)} disabled={copy.isPending}>{t("invoices.page.copy")}</Button>
          {cancelledBy ? (
            <Button asChild variant="secondary"><Link to={invoicePath(cancelledBy.id)}>{t("invoices.page.openCancellation")}</Link></Button>
          ) : hasPdf && (
            // Without its stored file the invoice cannot be cancelled yet: the retry comes first.
            <Button variant="destructive" onClick={() => setConfirmingCancel(true)}>{t("invoices.page.cancel")}</Button>
          )}
        </>
      )}
      {invoice.status === "cancelled" && isInvoice && (
        <Button onClick={() => copy.mutate(invoice.id, goToDraft)} disabled={copy.isPending}>{t("invoices.page.correct")}</Button>
      )}
      {sending && (
        <IssueInvoiceDialog
          invoice={invoice}
          mode="send"
          resend={!!invoice.sent_at}
          open
          onOpenChange={setSending}
          onStateChanged={onStateChanged}
        />
      )}
      <DeleteConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title={t("invoices.page.cancelTitle")}
        body={t("invoices.page.cancelBody")}
        confirmLabel={t("invoices.page.cancelConfirm")}
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate(invoice.id, { onSuccess: (id) => { setConfirmingCancel(false); navigate(invoicePath(id)); } })}
      />
    </>
  );
}

/** An issued invoice whose PDF is missing (rendering failed after the number was drawn): issuing
 *  again only re-renders it. */
export function PdfPendingNotice({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const { t } = useTranslation("werkbank");
  const issue = useIssueInvoice();
  const retry = () =>
    issue.mutateAsync({ invoiceId })
      .then(() => { toast.success(t("invoices.page.pdfRetryDone")); onDone(); })
      .catch((e) => {
        // The invoice is issued either way; a conflict means someone else finished it meanwhile.
        if (e instanceof InvoiceActionError && e.code === "invalid_state") onDone();
        else toast.error(t("invoices.page.pdfRetryFailed"));
      });
  return (
    <Alert className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="m-0 font-medium">{t("invoices.page.pdfPending")}</p>
        <p className="m-0 text-muted-foreground">{t("invoices.page.pdfPendingHint")}</p>
      </div>
      <Button variant="secondary" disabled={issue.isPending} onClick={() => void retry()}>{t("invoices.page.pdfRetry")}</Button>
    </Alert>
  );
}
