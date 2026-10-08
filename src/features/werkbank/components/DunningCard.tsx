import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { berlinDateKey, formatDateDMY } from "@/lib/dates";
import type { DunningNotice } from "../data/dunning";
import { useDunningDownload, useIssueDunning } from "../hooks/useDunningActions";
import { useClearDunningHold, useDunningHold, useDunningNotices, useInvoiceBalance } from "../hooks/useOpenItems";
import { dunningBlockers, nextDunningStage } from "../lib/dunningBlockers";
import { stageKey } from "../lib/stageKey";
import { openPendingTab, showInTab } from "../lib/pdfTab";
import { CreateDunningDialog } from "./CreateDunningDialog";
import { DunningHoldDialog } from "./DunningHoldDialog";
import { SendDunningDialog } from "./SendDunningDialog";

type DunningInvoice = { id: string; customer_id: string; contact_id: string | null; status: string; type: string; due_date: string | null };

/** The dunning notices of an issued or cancelled invoice, the button for the next one and the
 *  hold. A cancelled invoice keeps its notices as a record: no create button, no hold actions.
 *  The button is disabled with the first client-side blocker as its tooltip; the server decides. */
export function DunningCard({ invoice }: { invoice: DunningInvoice }) {
  const { t } = useTranslation("werkbank");
  const balance = useInvoiceBalance(invoice.id);
  const noticesQuery = useDunningNotices(invoice.id);
  const holdQuery = useDunningHold(invoice.id);
  const clearHold = useClearDunningHold();
  const [dialog, setDialog] = useState<"create" | "hold" | null>(null);
  const close = (next: boolean) => { if (!next) setDialog(null); };

  if (balance.isLoading || noticesQuery.isLoading || holdQuery.isLoading) return <Skeleton className="h-24 w-full" />;
  if (balance.isError || noticesQuery.isError || holdQuery.isError) return <Alert variant="destructive">{t("dunning.loadFailed")}</Alert>;

  const notices = noticesQuery.data ?? [];
  const hold = holdQuery.data ?? null;
  const today = berlinDateKey(new Date());
  const issued = invoice.status === "issued";
  const stage = nextDunningStage(notices);
  const blockers = dunningBlockers({ invoice, openAmount: balance.data?.open_amount, hold, notices, today });
  const holdActive = !!hold && (hold.until === null || hold.until >= today);
  // Emailing a notice again needs what creating one needs: an issued invoice, something open and
  // no active hold (the server checks the same). Storing an unrendered notice is always allowed.
  // Only the latest stage is sent again (the edge refuses an older one: not_latest_notice).
  const latestStage = Math.max(0, ...notices.map((n) => n.stage));
  const canEmail = issued && invoice.type === "invoice" && (balance.data?.open_amount ?? 0) > 0 && !holdActive;
  const createLabel = t("dunning.create.button", { stage: t(stageKey(stage)) });
  const blockerText = blockers[0] ? t(`dunning.blockers.${blockers[0]}`) : null;

  return (
    <section className="space-y-3" aria-labelledby="invoice-dunning">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="invoice-dunning" className="m-0 text-lg font-semibold">{t("dunning.title")}</h2>
        {issued && (
          <div className="ml-auto flex flex-wrap gap-2">
            {!holdActive && <Button variant="secondary" onClick={() => setDialog("hold")}>{t("dunning.hold.set")}</Button>}
            {blockerText ? (
              // A disabled button takes no focus: the focusable wrapper carries label and reason, so
              // the tooltip opens from the keyboard too.
              <IconTooltip label={blockerText}>
                <span role="button" aria-disabled="true" tabIndex={0} aria-label={createLabel} aria-describedby="dunning-create-blocker"
                  className="inline-flex rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Button disabled tabIndex={-1} aria-hidden>{createLabel}</Button>
                  <span id="dunning-create-blocker" className="sr-only">{blockerText}</span>
                </span>
              </IconTooltip>
            ) : <Button onClick={() => setDialog("create")}>{createLabel}</Button>}
          </div>
        )}
      </div>

      {issued && holdActive && hold && (
        <Alert className="flex flex-wrap items-center gap-3">
          <span>
            {t("dunning.hold.banner", { reason: hold.reason })}{" "}
            {hold.until ? <>{t("dunning.hold.bannerUntil")} <Metric size="body">{formatDateDMY(hold.until)}</Metric></> : t("dunning.hold.bannerOpen")}
          </span>
          <Button variant="secondary" className="ml-auto" disabled={clearHold.isPending} onClick={() => void clearHold.mutateAsync(invoice.id).catch(() => undefined)}>
            {t("dunning.hold.clear")}
          </Button>
        </Alert>
      )}

      {notices.length ? (
        <ul className="m-0 list-none divide-y divide-border rounded-card border border-border p-0">
          {notices.map((n) => <NoticeRow key={n.id} notice={n} invoice={invoice} canEmail={canEmail && n.stage === latestStage} />)}
        </ul>
      ) : <p className="m-0 text-sm text-muted-foreground">{t("dunning.empty")}</p>}

      {dialog === "create" && <CreateDunningDialog invoice={invoice} stage={stage} onOpenChange={close} />}
      {dialog === "hold" && <DunningHoldDialog invoiceId={invoice.id} onOpenChange={close} />}
    </section>
  );
}

function NoticeRow({ notice: n, invoice, canEmail }: { notice: DunningNotice; invoice: DunningInvoice; canEmail: boolean }) {
  const { t } = useTranslation("werkbank");
  const download = useDunningDownload();
  const issue = useIssueDunning();
  const [sendDialog, setSendDialog] = useState<"resend" | "retry" | null>(null);
  // A notice without its file is still being rendered (or the render failed): retrying resumes it.
  const unrendered = !n.pdf_path;
  const mailFailed = !unrendered && n.delivery === "email" && !n.sent_at;
  const recipients = n.sent_to ?? [];

  const openPdf = () => {
    const tab = openPendingTab();
    return download.mutateAsync(n.id)
      .then((url) =>
        showInTab(tab, url, (blocked) =>
          toast.error(t("invoices.page.pdfBlocked"), { action: { label: t("invoices.page.pdfOpen"), onClick: () => window.open(blocked, "_blank", "noopener") } })))
      .catch(() => {
        tab?.close();
        toast.error(t("invoices.page.pdfFailed"));
      });
  };
  // Without a send only the PDF is stored (a print notice, or an email notice that may not go out
  // any more); an email notice that may go out asks for its recipients first.
  const storeOnly = () =>
    issue.mutateAsync({ invoiceId: n.invoice_id, delivery: n.delivery === "email" ? "email" : "print" })
      .then(() => toast.success(t("dunning.row.retried")))
      .catch(() => toast.error(t("dunning.row.retryFailed")));
  const retry = () => (n.delivery === "email" && canEmail ? setSendDialog("retry") : void storeOnly());

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
      <span className="font-medium">{t(stageKey(n.stage))}</span>
      <Metric size="body">{formatDateDMY(n.notice_date)}</Metric>
      <span className="text-muted-foreground">{t("dunning.row.deadline")} <Metric size="body">{formatDateDMY(n.payment_deadline)}</Metric></span>
      <StatusPill tone={mailFailed || unrendered ? "waiting" : "neutral"}>
        {t(unrendered ? "dunning.row.rendering" : mailFailed ? "dunning.row.sendFailed" : n.delivery === "email" ? "dunning.row.email" : "dunning.row.print")}
      </StatusPill>
      {recipients.length > 0 && <span className="text-muted-foreground">{recipients.join(", ")}</span>}
      <span className="ml-auto flex gap-2">
        {n.pdf_path && <Button variant="secondary" disabled={download.isPending} onClick={() => void openPdf()}>{t("dunning.row.pdf")}</Button>}
        {unrendered && <Button variant="secondary" disabled={issue.isPending} onClick={retry}>{t("dunning.row.retry")}</Button>}
        {n.delivery === "email" && n.pdf_path && canEmail && (
          <Button variant="secondary" onClick={() => setSendDialog("resend")}>{t("dunning.row.resend")}</Button>
        )}
      </span>
      {sendDialog && (
        <SendDunningDialog notice={n} invoice={invoice} retry={sendDialog === "retry"} onOpenChange={(o) => { if (!o) setSendDialog(null); }} />
      )}
    </li>
  );
}
