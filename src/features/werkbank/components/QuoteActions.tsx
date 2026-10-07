import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Quote } from "../data/quotes";
import { useQuoteActions } from "../hooks/useQuoteActions";
import { openPendingTab, showInTab } from "../lib/pdfTab";
import { SendQuoteDialog } from "./SendQuoteDialog";

/** The edge-backed buttons of the quote page: preview and send for a draft, send again for a
 *  sent quote, and the PDF whenever one was stored (also for rejected and superseded quotes).
 *  The send dialog lives here. */
export function QuoteActions({
  quote,
}: {
  quote: Pick<Quote, "id" | "customer_id" | "property_id" | "contact_id" | "status" | "valid_until" | "pdf_path" | "accepted_pdf_path">;
}) {
  const { t } = useTranslation("werkbank");
  const actions = useQuoteActions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const isDraft = quote.status === "draft";
  const hasPdf = !!quote.pdf_path;
  // The signed copy once it exists, otherwise the document as it was sent.
  const pdfKind = quote.status === "accepted" && quote.accepted_pdf_path ? "accepted" : "sent";

  const blocked = (url: string) =>
    toast.error(t("quotes.page.pdfBlocked"), { action: { label: t("quotes.page.pdfOpen"), onClick: () => window.open(url, "_blank") } });

  // The tab is opened inside the click, before the edge call, so the browser allows it.
  const showPdf = (get: () => Promise<string>) => {
    const tab = openPendingTab();
    return get()
      .then((url) => showInTab(tab, url, blocked))
      .catch(() => {
        tab?.close();
        toast.error(t("quotes.page.pdfFailed"));
      });
  };

  const openPdf = () =>
    showPdf(() => actions.download.mutateAsync({ quoteId: quote.id, kind: pdfKind }));
  const preview = () => showPdf(() => actions.preview.mutateAsync(quote.id));

  return (
    <>
      {isDraft && (
        <>
          <Button variant="secondary" disabled={actions.preview.isPending} onClick={() => void preview()}>
            {t("quotes.send.preview")}
          </Button>
          <Button onClick={() => setDialogOpen(true)}>{t("quotes.send.submit")}</Button>
        </>
      )}
      {quote.status === "sent" && (
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>{t("quotes.send.resend")}</Button>
      )}
      {hasPdf && (
        <Button variant="secondary" disabled={actions.download.isPending} onClick={() => void openPdf()}>
          {t("quotes.page.pdf")}
        </Button>
      )}
      {dialogOpen && (
        <SendQuoteDialog quote={quote} open onOpenChange={setDialogOpen} onResend={() => setDialogOpen(true)} />
      )}
    </>
  );
}
