import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import { formatDateDMY } from "@/lib/dates";
import type { InvoiceEntry } from "../data/invoiceEntries";
import { useInvoiceBalance, useInvoiceEntries, useTransferDestinations } from "../hooks/useOpenItems";
import { formatEuro } from "../lib/money";
import { paymentStatus } from "../lib/paymentStatus";
import { invoicePath } from "../paths";
import type { RecordEntryMode } from "../schemas/payment";
import { RecordEntryDialog } from "./RecordEntryDialog";
import { ReverseEntryDialog } from "./ReverseEntryDialog";
import { TransferEntryDialog } from "./TransferEntryDialog";

type Dialog = { type: "record"; mode: RecordEntryMode } | { type: "reverse"; entryId: string } | { type: "transfer"; entryId: string };

/** The payments of an issued or cancelled invoice: claim, paid, written off and open (or credit),
 *  the append-only ledger and the actions to book into it. A cancelled invoice takes no new
 *  payment or write-off, but credit left on it can be moved or refunded. */
export function PaymentsCard({ invoiceId, customerId, status }: { invoiceId: string; customerId: string; status: string }) {
  const { t, i18n } = useTranslation("werkbank");
  const balanceQuery = useInvoiceBalance(invoiceId);
  const entriesQuery = useInvoiceEntries(invoiceId);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const balance = balanceQuery.data;
  const entries = entriesQuery.data ?? [];
  const destinations = useTransferDestinations(entries.filter((e) => e.reversed_at && e.kind === "payment").map((e) => e.id)).data;

  if (balanceQuery.isLoading || entriesQuery.isLoading) return <Skeleton className="h-32 w-full" />;
  if (balanceQuery.isError || entriesQuery.isError) return <Alert variant="destructive">{t("payments.loadFailed")}</Alert>;
  if (!balance) return null;

  const money = (n: number | null | undefined) => formatEuro(n ?? 0, i18n.language);
  const open = balance.open_amount ?? 0;
  const credit = open < 0;
  const issued = status === "issued";
  const pill = paymentStatus(balance);
  // The payment the credit notice moves: the largest one that fits into the credit (the database
  // refuses more, transfer_exceeds_credit), so a partly refunded payment is not offered.
  const movable = entries
    .filter((e) => e.kind === "payment" && !e.reversed_at && Math.round(e.amount * 100) <= Math.round(-open * 100))
    .sort((a, b) => b.amount - a.amount)[0];
  const close = (next: boolean) => { if (!next) setDialog(null); };
  const stat = (label: string, value: number | null) => (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <Metric size="lg">{money(value)}</Metric>
    </div>
  );

  return (
    <section className="space-y-3" aria-labelledby="invoice-payments">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="invoice-payments" className="m-0 text-lg font-semibold">{t("payments.title")}</h2>
        <StatusPill tone={pill.tone}>{t(pill.labelKey)}</StatusPill>
        <div className="ml-auto flex flex-wrap gap-2">
          {issued && open > 0 && <Button variant="secondary" onClick={() => setDialog({ type: "record", mode: "write_off" })}>{t("payments.writeOff")}</Button>}
          {credit && <Button variant="secondary" onClick={() => setDialog({ type: "record", mode: "refund" })}>{t("payments.refund")}</Button>}
          {issued && <Button onClick={() => setDialog({ type: "record", mode: "payment" })}>{t("payments.recordPayment")}</Button>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 rounded-card border border-border p-4 sm:grid-cols-4">
        {stat(t("payments.claim"), balance.claim)}
        {stat(t("payments.paid"), balance.paid)}
        {stat(t("payments.writtenOff"), balance.written_off)}
        {stat(t(credit ? "payments.credit" : "payments.open"), Math.abs(open))}
      </div>
      {!issued && credit && (
        <Alert className="flex flex-wrap items-center gap-3">
          <span>
            {t("payments.credit")} <Metric size="body">{money(-open)}</Metric>.{" "}
            {movable ? t("payments.cancelledCreditMove") : t("payments.cancelledCredit")}
          </span>
          {movable && (
            <Button variant="secondary" className="ml-auto" onClick={() => setDialog({ type: "transfer", entryId: movable.id })}>
              {t("payments.transfer")}
            </Button>
          )}
        </Alert>
      )}

      {entries.length ? (
        <ul className="m-0 list-none divide-y divide-border rounded-card border border-border p-0">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} money={money} movedTo={destinations?.get(e.id)}
              onReverse={() => setDialog({ type: "reverse", entryId: e.id })}
              onTransfer={() => setDialog({ type: "transfer", entryId: e.id })} />
          ))}
        </ul>
      ) : <p className="m-0 text-sm text-muted-foreground">{t("payments.empty")}</p>}

      {dialog?.type === "record" && (
        <RecordEntryDialog invoiceId={invoiceId} mode={dialog.mode} openAmount={open} refreshing={balanceQuery.isFetching} onStale={() => void balanceQuery.refetch()} onOpenChange={close} />
      )}
      {dialog?.type === "reverse" && <ReverseEntryDialog entryId={dialog.entryId} onOpenChange={close} />}
      {dialog?.type === "transfer" && <TransferEntryDialog entryId={dialog.entryId} invoiceId={invoiceId} customerId={customerId} onOpenChange={close} />}
    </section>
  );
}

function EntryRow({ entry: e, money, movedTo, onReverse, onTransfer }: {
  entry: InvoiceEntry; money: (n: number) => string; movedTo?: { invoiceId: string; invoiceNo: string | null };
  onReverse: () => void; onTransfer: () => void;
}) {
  const { t } = useTranslation("werkbank");
  const reversed = !!e.reversed_at;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
      <span data-testid={`entry-${e.id}`} className={reversed ? "flex flex-wrap items-center gap-x-3 line-through text-muted-foreground" : "flex flex-wrap items-center gap-x-3"}>
        <StatusPill tone="neutral">{t(`payments.kind.${e.kind}`)}</StatusPill>
        <Metric size="body">{formatDateDMY(e.booked_on)}</Metric>
        <Metric size="body">{money(e.amount)}</Metric>
        {e.write_off_reason && <span>{t(`payments.reason.${e.write_off_reason}`)}</span>}
        {e.note && <span>{e.note}</span>}
      </span>
      {e.transferred_from && <span className="text-muted-foreground">{t("payments.movedHere")}</span>}
      {reversed && <span className="text-muted-foreground">{t("payments.reversedNote", { reason: e.reversal_reason ?? "" })}</span>}
      {movedTo && (
        <span className="text-muted-foreground">
          {t("payments.movedTo")}{" "}
          <Link to={invoicePath(movedTo.invoiceId)} className="underline"><Token>{movedTo.invoiceNo ?? movedTo.invoiceId}</Token></Link>
        </span>
      )}
      {!reversed && (
        <span className="ml-auto flex gap-2">
          {e.kind === "payment" && <Button variant="secondary" onClick={onTransfer}>{t("payments.transfer")}</Button>}
          <Button variant="secondary" onClick={onReverse}>{t("payments.reverse")}</Button>
        </span>
      )}
    </li>
  );
}
