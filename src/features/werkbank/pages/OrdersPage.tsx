import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, ClipboardList } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page-header";
import { PageMini } from "@/components/minis/PageMini";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Token } from "@/components/ui/token";
import { useAuth } from "@/features/auth/AuthContext";
import { formatDateDMY } from "@/lib/dates";
import { CustomerPicker } from "../components/CustomerPicker";
import { DatePopover } from "../components/DatePopover";
import type { OrderListRow } from "../data/orders";
import { useOrderList, useOrderMutations } from "../hooks/useOrders";
import { useTechnicians } from "../hooks/useTechnicians";
import { formatEuro } from "../lib/money";
import { ORDER_STATUSES, ORDER_STATUS_TONES, needsSchedule, type OrderStatus } from "../lib/orderStatus";
import { orderPath } from "../paths";

const ALL = "__all__";

function NewOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("werkbank");
  const navigate = useNavigate();
  const { create } = useOrderMutations();
  const [customerId, setCustomerId] = useState("");

  const submit = () =>
    create.mutate(
      { customer_id: customerId },
      {
        onSuccess: (id) => {
          onOpenChange(false);
          setCustomerId("");
          navigate(orderPath(id));
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("orders.new.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-order-customer">{t("orders.new.customer")}</Label>
          <CustomerPicker id="new-order-customer" value={customerId} onChange={setCustomerId} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!customerId || create.isPending} onClick={submit}>
            {t("orders.new.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One end of the date range: a calendar popover that shows the picked day. */
function RangeEnd({ id, label, value, onSelect }: { id: string; label: string; value: string | null; onSelect: (date: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <DatePopover value={value} onSelect={onSelect}>
        <Button id={id} variant="secondary" className="gap-2">
          <CalendarDays className="h-4 w-4" aria-hidden />
          <span>{label}</span>
          {value && <Metric size="body">{formatDateDMY(value)}</Metric>}
        </Button>
      </DatePopover>
    </div>
  );
}

/** The org's orders: filter by status, technician, date range or "not scheduled", create a
 *  direct order. A row opens the order. */
export function OrdersPage() {
  const { t, i18n } = useTranslation("werkbank");
  const navigate = useNavigate();
  const orgId = useAuth().currentOrg?.id;
  const { data: orders, isLoading, isError } = useOrderList();
  const { data: technicians } = useTechnicians(orgId);

  // Links from the dashboard and the invoices page open with ?status=done; an unknown status is ignored.
  const [params] = useSearchParams();
  const urlStatus = params.get("status");
  const statusFromUrl = urlStatus && (ORDER_STATUSES as readonly string[]).includes(urlStatus) ? urlStatus : ALL;
  const [status, setStatus] = useState(statusFromUrl);
  const [appliedStatus, setAppliedStatus] = useState(statusFromUrl);
  if (statusFromUrl !== appliedStatus) {
    setAppliedStatus(statusFromUrl);
    setStatus(statusFromUrl);
  }
  const [technician, setTechnician] = useState(ALL);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  // The dashboard links here with ?unscheduled=1.
  const urlUnscheduled = params.get("unscheduled") === "1";
  const [unscheduled, setUnscheduled] = useState(urlUnscheduled);
  // The page stays mounted when another dashboard link changes the params: apply them again
  // (adjusting state while rendering).
  const [appliedUnscheduled, setAppliedUnscheduled] = useState(urlUnscheduled);
  if (urlUnscheduled !== appliedUnscheduled) {
    setAppliedUnscheduled(urlUnscheduled);
    setUnscheduled(urlUnscheduled);
    if (urlUnscheduled) {
      setFrom(null);
      setTo(null);
    }
  }
  // The dashboard's "reported by technician" tile links here with ?byTechnician=1.
  const byTechnician = params.get("byTechnician") === "1";
  const emptyRange = !!from && !!to && from > to;
  const [creating, setCreating] = useState(false);

  const visible = useMemo(
    () =>
      (orders ?? []).filter((o) => {
        if (status !== ALL && o.status !== status) return false;
        if (byTechnician && !o.completed_by_technician) return false;
        if (technician !== ALL && !o.technician_ids?.includes(technician)) return false;
        if (unscheduled) return needsSchedule(o);
        if (from || to) return !!o.scheduled_date && (!from || o.scheduled_date >= from) && (!to || o.scheduled_date <= to);
        return true;
      }),
    [orders, status, technician, from, to, unscheduled, byTechnician],
  );

  const pickFrom = (date: string) => { setUnscheduled(false); setFrom(date); };
  const pickTo = (date: string) => { setUnscheduled(false); setTo(date); };
  const toggleUnscheduled = () => {
    setFrom(null);
    setTo(null);
    setUnscheduled((on) => !on);
  };

  const when = (o: OrderListRow) =>
    o.scheduled_date && (
      <Metric size="body">{`${formatDateDMY(o.scheduled_date)}${o.scheduled_time ? ` ${o.scheduled_time.slice(0, 5)}` : ""}`}</Metric>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("orders.title")}
        sub={t("orders.sub")}
        actions={<Button onClick={() => setCreating(true)}>{t("orders.add")}</Button>}
      />

      <PageMini page="orders" />

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <Alert variant="destructive">{t("orders.loadFailed")}</Alert>
      ) : !orders || orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t("orders.empty.title")}
          body={t("orders.empty.body")}
          action={{ label: t("orders.empty.action"), onClick: () => setCreating(true) }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[180px]" aria-label={t("orders.statusFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("orders.allStatuses")}</SelectItem>
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{t(`orders.status.${s}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={technician} onValueChange={setTechnician}>
              <SelectTrigger className="w-[200px]" aria-label={t("orders.technicianFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("orders.allTechnicians")}</SelectItem>
                {(technicians ?? []).map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>{tech.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <RangeEnd id="orders-from" label={t("orders.range.from")} value={from} onSelect={pickFrom} />
            <RangeEnd id="orders-to" label={t("orders.range.to")} value={to} onSelect={pickTo} />
            {(from || to) && (
              <Button variant="secondary" onClick={() => { setFrom(null); setTo(null); }}>{t("orders.range.reset")}</Button>
            )}
            <Button variant={unscheduled ? "default" : "secondary"} aria-pressed={unscheduled} onClick={toggleUnscheduled}>
              {t("orders.unscheduled")}
            </Button>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              size="inline"
              title={emptyRange && !unscheduled ? t("orders.range.invalid") : t("orders.noMatches")}
              reason={t("orders.noMatchesReason")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("orders.columns.number")}</TableHead>
                  <TableHead>{t("orders.columns.customer")}</TableHead>
                  <TableHead>{t("orders.columns.subject")}</TableHead>
                  <TableHead>{t("orders.columns.when")}</TableHead>
                  <TableHead>{t("orders.columns.technicians")}</TableHead>
                  <TableHead className="text-right">{t("orders.columns.gross")}</TableHead>
                  <TableHead>{t("orders.columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((o) => {
                  const s = (o.status ?? "open") as OrderStatus;
                  return (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(orderPath(o.id!))}>
                      <TableCell><Token>{o.order_no}</Token></TableCell>
                      <TableCell>
                        <div className="font-medium">{o.customer_name}</div>
                        {o.property_name && <div className="text-muted-foreground">{o.property_name}</div>}
                      </TableCell>
                      <TableCell>{o.subject}</TableCell>
                      <TableCell>{when(o)}</TableCell>
                      <TableCell>{(o.technician_names ?? []).join(", ")}</TableCell>
                      <TableCell className="text-right">
                        <Metric size="body">{formatEuro(o.gross_total ?? 0, i18n.language)}</Metric>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={ORDER_STATUS_TONES[s]}>{t(`orders.status.${s}`)}</StatusPill>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <NewOrderDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
