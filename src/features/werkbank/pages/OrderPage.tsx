import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import { DeleteConfirmDialog } from "../components/DeleteConfirmDialog";
import { DocumentTotalsCard } from "../components/DocumentTotalsCard";
import { LineItemsEditor } from "../components/LineItemsEditor";
import { OrderHeaderForm } from "../components/OrderHeaderForm";
import { OrderScheduleCard, type SchedulePatch } from "../components/OrderScheduleCard";
import { QuoteComparison } from "../components/QuoteComparison";
import type { OrderPatch } from "../data/orders";
import { useCustomer } from "../hooks/useCustomers";
import { useDocumentItems } from "../hooks/useDocumentItems";
import { useOrder, useOrderList, useOrderMutations } from "../hooks/useOrders";
import { useQuote } from "../hooks/useQuotes";
import { mapDbError } from "../lib/dbErrors";
import { ORDER_ACTION_TARGET, ORDER_STATUS_TONES, nextOrderActions, type OrderAction, type OrderStatus } from "../lib/orderStatus";
import { diffAgainstQuote } from "../lib/quoteDiff";
import { formatQuoteNumber } from "../lib/quoteNumber";
import { ORDERS_PATH, quotePath } from "../paths";

const ACTION_VARIANT = { start: "default", complete: "default", reopen: "secondary", cancel: "destructive" } as const;

/** One order: header, schedule and technicians, line items, totals, and for an order made
 *  from a quote the comparison with it. Open and in-progress orders are edited in place; done
 *  and cancelled ones are read only. An open order can still be deleted. */
export function OrderPage() {
  const { t } = useTranslation("werkbank");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: order, isLoading, isError, refetch } = useOrder(id);
  const { data: list } = useOrderList();
  const { data: customer } = useCustomer(order?.customer_id);
  const { data: quote } = useQuote(order?.quote_id ?? undefined);
  const { data: quoteItems } = useDocumentItems(order?.quote_id ? { quoteId: order.quote_id } : undefined);
  const { data: orderItems } = useDocumentItems(order ? { orderId: order.id } : undefined);
  const { update, setStatus, setTechnicians, remove } = useOrderMutations();
  // Keyed by the order id: the route reuses this component, so a lock must not carry over to
  // the next order the user navigates to.
  const [lockedId, setLockedId] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const diff = useMemo(
    () => (quoteItems && orderItems ? diffAgainstQuote(orderItems, quoteItems) : null),
    [quoteItems, orderItems],
  );

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) return <Alert variant="destructive">{t("orders.page.loadFailed")}</Alert>;
  // After a delete the refetch finds no order before the navigation runs: keep the skeleton instead
  // of flashing "not found".
  if (!order && (remove.isPending || remove.isSuccess)) return <Skeleton className="h-48 w-full" />;
  if (!order) {
    return (
      <div className="space-y-4">
        <EmptyState icon={ClipboardList} title={t("orders.page.notFound.title")} reason={t("orders.page.notFound.reason")} />
        <p className="text-center">
          <Link to={ORDERS_PATH} className="text-sm font-medium text-accent-text hover:underline">
            {t("orders.page.notFound.back")}
          </Link>
        </p>
      </div>
    );
  }

  const status = order.status as OrderStatus;
  const locked = lockedId === order.id;
  const readOnly = locked || status === "done" || status === "cancelled";
  const listRow = list?.find((o) => o.id === order.id);

  // A save that hits an order closed meanwhile: fetch the real state, so the page turns read only.
  const lock = () => {
    setLockedId(order.id);
    void refetch();
  };
  const lockOnClosed = { onError: (e: unknown) => mapDbError(e) === "errors.orderLocked" && lock() };
  const save = (patch: OrderPatch | SchedulePatch) => update.mutate({ id: order.id, patch }, lockOnClosed);
  const saveTechnicians = (artistIds: string[]) => setTechnicians.mutate({ orderId: order.id, artistIds }, lockOnClosed);
  const runAction = (action: OrderAction) => setStatus.mutate({ id: order.id, status: ORDER_ACTION_TARGET[action] });

  return (
    <div className="space-y-6">
      <Link to={ORDERS_PATH} className="text-sm font-medium text-accent-text hover:underline">
        {t("orders.page.back")}
      </Link>
      <PageHeader
        eyebrow={t("orders.title")}
        title={order.subject ?? order.order_no}
        actions={
          <>
            {nextOrderActions(status).map((action) => (
              <Button key={action} variant={ACTION_VARIANT[action]} disabled={setStatus.isPending} onClick={() => (action === "cancel" ? setConfirmingCancel(true) : runAction(action))}>
                {t(`orders.action.${action}`)}
              </Button>
            ))}
            {status === "open" && !locked && (
              <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
                {t("orders.page.delete")}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Token className="text-lg">{order.order_no}</Token>
        <StatusPill tone={ORDER_STATUS_TONES[status]}>{t(`orders.status.${status}`)}</StatusPill>
        {order.quote_id && quote && (
          <span className="text-sm">
            {t("orders.page.fromQuote")}{" "}
            <Link to={quotePath(quote.id)} className="font-medium text-accent-text hover:underline">
              <Token>{formatQuoteNumber(quote.quote_no, quote.version)}</Token>
            </Link>
          </span>
        )}
      </div>

      {locked && <Alert variant="destructive">{t("errors.orderLocked")}</Alert>}

      <OrderHeaderForm
        key={`${order.id}-${readOnly}`}
        order={order}
        readOnly={readOnly}
        names={{ customer: listRow?.customer_name ?? null, property: listRow?.property_name ?? null }}
        onPatch={save}
      />

      <OrderScheduleCard
        date={order.scheduled_date}
        time={order.scheduled_time}
        technicianIds={order.technician_ids}
        technicianNames={order.technician_names}
        readOnly={readOnly}
        onSchedule={save}
        techniciansPending={setTechnicians.isPending}
        onTechnicians={saveTechnicians}
      />

      {quote && diff && orderItems && (
        <QuoteComparison
          quoteNumber={formatQuoteNumber(quote.quote_no, quote.version)}
          quoteGross={quote.totals?.gross_total ?? 0}
          orderGross={order.totals?.gross_total ?? 0}
          orderItems={orderItems}
          diff={diff}
        />
      )}

      <LineItemsEditor docRef={{ orderId: order.id }} readOnly={readOnly} marks={diff ?? undefined} onLocked={lock} />
      <DocumentTotalsCard totals={order.totals} isPrivateCustomer={customer?.kind === "private"} />

      <DeleteConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("orders.page.deleteTitle")}
        body={t("orders.page.deleteBody", { number: order.order_no })}
        onConfirm={() =>
          remove.mutate(order.id, {
            onSuccess: () => { setConfirmingDelete(false); navigate(ORDERS_PATH); },
            // Started meanwhile: show the real status (the hook toasts why nothing was deleted).
            onError: () => { setConfirmingDelete(false); void refetch(); },
          })}
        pending={remove.isPending}
      />

      <AlertDialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("orders.cancel.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("orders.cancel.body", { number: order.order_no })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("orders.cancel.keep")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={setStatus.isPending}
              onClick={() => { setConfirmingCancel(false); runAction("cancel"); }}
            >
              {t("orders.cancel.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
