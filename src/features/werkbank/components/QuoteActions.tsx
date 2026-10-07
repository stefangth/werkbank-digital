import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Quote } from "../data/quotes";
import { useQuoteActions } from "../hooks/useQuoteActions";
import { SendQuoteDialog } from "./SendQuoteDialog";

/** The edge-backed buttons of the quote page: preview and send for a draft, send again for a
 *  sent quote, and the PDF once it was sent. The send dialog lives here. */
export function QuoteActions({ quote }: { quote: Pick<Quote, "id" | "customer_id" | "property_id" | "contact_id" | "status" | "valid_until"> }) {
  const { t } = useTranslation("werkbank");
  const actions = useQuoteActions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const isDraft = quote.status === "draft";
  const hasPdf = quote.status === "sent" || quote.status === "accepted";

  const openPdf = () =>
    actions.download
      .mutateAsync({ quoteId: quote.id, kind: quote.status === "accepted" ? "accepted" : "sent" })
      .then((url) => window.open(url, "_blank"))
      .catch(() => toast.error(t("quotes.page.pdfFailed")));

  const preview = () => actions.preview.mutateAsync(quote.id).catch(() => toast.error(t("quotes.page.pdfFailed")));

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
