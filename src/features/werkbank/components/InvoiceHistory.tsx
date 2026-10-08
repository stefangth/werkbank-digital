import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import { formatTimestampLocal } from "@/lib/dates";
import type { Invoice } from "../data/invoices";
import { invoicePath } from "../paths";

/** What happened to an issued invoice, derived from its own fields (there is no audit table):
 *  issued, sent (with the recipients) and the cancellation document that cancelled it. */
export function InvoiceHistory({
  invoice, cancelledBy,
}: {
  invoice: Pick<Invoice, "status" | "issued_at" | "sent_at" | "sent_to">;
  cancelledBy?: { id: string; invoice_no: string | null } | null;
}) {
  const { t } = useTranslation("werkbank");
  if (invoice.status === "draft" || (!invoice.issued_at && !invoice.sent_at && !cancelledBy)) return null;

  return (
    <section className="space-y-3" aria-labelledby="invoice-history">
      <h2 id="invoice-history" className="m-0 text-lg font-semibold">{t("invoices.history.title")}</h2>
      <ul className="m-0 list-none divide-y divide-border rounded-card border border-border p-0">
        {invoice.issued_at && (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <StatusPill tone="confirmed">{t("invoices.history.issued")}</StatusPill>
            <Metric size="body">{formatTimestampLocal(invoice.issued_at)}</Metric>
          </li>
        )}
        {invoice.sent_at && (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <StatusPill tone="waiting">{t("invoices.history.sent")}</StatusPill>
            <Metric size="body">{formatTimestampLocal(invoice.sent_at)}</Metric>
            {invoice.sent_to && invoice.sent_to.length > 0 && (
              <span className="text-muted-foreground">{t("invoices.history.sentTo", { recipients: invoice.sent_to.join(", ") })}</span>
            )}
          </li>
        )}
        {cancelledBy && (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <StatusPill tone="neutral">{t("invoices.status.cancelled")}</StatusPill>
            <span className="text-muted-foreground">{t("invoices.history.cancelledBy")}</span>
            <Link to={invoicePath(cancelledBy.id)} className="font-medium text-accent-text hover:underline">
              <Token>{cancelledBy.invoice_no}</Token>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
