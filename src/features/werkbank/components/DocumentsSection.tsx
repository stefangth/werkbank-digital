import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Token } from "@/components/ui/token";
import { useCompanyProfile } from "../hooks/useCompanyProfile";
import { useOrderList, useOrderMutations } from "../hooks/useOrders";
import { useQuoteList, useQuoteMutations } from "../hooks/useQuotes";
import { formatEuro } from "../lib/money";
import { ORDER_STATUS_TONES, type OrderStatus } from "../lib/orderStatus";
import { formatQuoteNumber } from "../lib/quoteNumber";
import { QUOTE_STATUS_TONE, quoteDisplayStatus } from "../lib/quoteStatus";
import { orderPath, quotePath } from "../paths";

/** The quotes and orders of one customer, or of one property when `propertyId` is given.
 *  Filtered client-side from the org-wide lists; the create buttons preselect both ids and
 *  open the new document. */
export function DocumentsSection({ customerId, propertyId }: { customerId?: string; propertyId?: string }) {
  const { t, i18n } = useTranslation("werkbank");
  const navigate = useNavigate();
  const quotes = useQuoteList();
  const orders = useOrderList();
  const profile = useCompanyProfile();
  const { create: createQuote } = useQuoteMutations();
  const { create: createOrder } = useOrderMutations();

  const mine = <R extends { customer_id: string | null; property_id: string | null }>(rows: R[] | undefined) =>
    (rows ?? []).filter((r) => (propertyId ? r.property_id === propertyId : r.customer_id === customerId));
  const quoteRows = mine(quotes.data);
  const orderRows = mine(orders.data);

  const newQuote = () =>
    createQuote.mutate(
      { draft: { customer_id: customerId!, property_id: propertyId ?? null }, profile: profile.data ?? null },
      { onSuccess: (id) => navigate(quotePath(id)) },
    );
  const newOrder = () =>
    createOrder.mutate(
      { customer_id: customerId!, property_id: propertyId ?? null },
      { onSuccess: (id) => navigate(orderPath(id)) },
    );

  const loading = quotes.isLoading || orders.isLoading;
  const failed = quotes.isError || orders.isError;

  const header = (id: string, title: string, label: string, onClick: () => void, disabled: boolean) => (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="m-0 text-lg font-semibold">{title}</h2>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={onClick}>{label}</Button>
    </div>
  );

  const body = (empty: string, rows: React.ReactNode[]) =>
    loading ? <Skeleton className="h-16 w-full" /> : failed ? <Alert variant="destructive">{t("documents.loadFailed")}</Alert>
    : rows.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{empty}</p>
    : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("documents.columns.number")}</TableHead>
            <TableHead>{t("documents.columns.subject")}</TableHead>
            <TableHead>{t("documents.columns.status")}</TableHead>
            <TableHead className="text-right">{t("documents.columns.gross")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{rows}</TableBody>
      </Table>
    );

  return (
    <>
      <section className="space-y-3" aria-labelledby="documents-quotes">
        {header("documents-quotes", t("documents.quotes.title"), t("documents.quotes.add"), newQuote,
          !customerId || profile.isLoading || createQuote.isPending)}
        {body(t("documents.quotes.empty"), quoteRows.map((q) => {
          const display = quoteDisplayStatus(q);
          const no = formatQuoteNumber(q.quote_no ?? "", q.version ?? 1);
          return (
            <TableRow key={q.id}>
              <TableCell><Link to={quotePath(q.id!)} className="hover:underline"><Token>{no}</Token></Link></TableCell>
              <TableCell>{q.subject}</TableCell>
              <TableCell><StatusPill tone={QUOTE_STATUS_TONE[display]}>{t(`quotes.status.${display}`)}</StatusPill></TableCell>
              <TableCell className="text-right"><Metric size="body">{formatEuro(q.gross_total ?? 0, i18n.language)}</Metric></TableCell>
            </TableRow>
          );
        }))}
      </section>

      <section className="space-y-3" aria-labelledby="documents-orders">
        {header("documents-orders", t("documents.orders.title"), t("documents.orders.add"), newOrder,
          !customerId || createOrder.isPending)}
        {body(t("documents.orders.empty"), orderRows.map((o) => {
          const s = (o.status ?? "open") as OrderStatus;
          return (
            <TableRow key={o.id}>
              <TableCell><Link to={orderPath(o.id!)} className="hover:underline"><Token>{o.order_no}</Token></Link></TableCell>
              <TableCell>{o.subject}</TableCell>
              <TableCell><StatusPill tone={ORDER_STATUS_TONES[s]}>{t(`orders.status.${s}`)}</StatusPill></TableCell>
              <TableCell className="text-right"><Metric size="body">{formatEuro(o.gross_total ?? 0, i18n.language)}</Metric></TableCell>
            </TableRow>
          );
        }))}
      </section>
    </>
  );
}
