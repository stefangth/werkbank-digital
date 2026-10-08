import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Navigation, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Metric } from "@/components/ui/metric";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import { useAuth } from "@/features/auth/AuthContext";
import { formatDateWithWeekday } from "@/lib/dates";
import type { AssignmentDetail } from "../data/technicianApp";
import { ASSIGNMENTS_KEY, useAssignment, useAssignmentActions } from "../hooks/useAssignments";
import { mapDbError } from "../lib/dbErrors";
import { ORDER_STATUS_TONES, type OrderStatus } from "../lib/orderStatus";
import { UNIT_CODES, unitLabelKey, type UnitCode } from "../lib/units";
import { ASSIGNMENTS_PATH } from "../paths";
import { mapsLink } from "./mapsLink";
import { MobileShell } from "./MobileShell";
import { TechnicianRoute } from "./TechnicianRoute";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="m-0"><Eyebrow>{title}</Eyebrow></h2>
      {children}
    </section>
  );
}

function Detail({ orderId, data, refetch }: { orderId: string; data: AssignmentDetail; refetch: () => Promise<{ data?: AssignmentDetail }> }) {
  const { t } = useTranslation("werkbank");
  const { start, complete } = useAssignmentActions(orderId);
  const [confirming, setConfirming] = useState(false);
  const { order, contact, items, technicians, reports } = data;
  const status = order.status as OrderStatus;
  const route = mapsLink(order);
  const address = [order.street, [order.postal_code, order.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const unitLabel = (u: string | null) => (u && (UNIT_CODES as readonly string[]).includes(u) ? t(unitLabelKey(u as UnitCode)) : (u ?? ""));

  const onComplete = () => {
    setConfirming(false);
    complete.mutate(undefined, {
      // A double tap makes the second request fail with invalid_transition. The hook stays
      // silent on it; after the refetch an order that is done counts as success.
      onError: async (e) => {
        if (mapDbError(e) !== "errors.invalidTransition") return;
        const fresh = await refetch();
        if (fresh.data?.order.status !== "done") toast.error(t("errors.invalidTransition"));
      },
    });
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Token>{order.order_no}</Token>
          <StatusPill tone={ORDER_STATUS_TONES[status] ?? "neutral"}>{t(`orders.status.${status}`)}</StatusPill>
        </div>
        <p className="m-0 text-control text-muted-foreground">
          {order.scheduled_date ? <Metric size="body">{formatDateWithWeekday(order.scheduled_date)}</Metric> : t("app.detail.noDate")}
          {order.scheduled_time && <> <Metric size="body">{order.scheduled_time.slice(0, 5)}</Metric></>}
        </p>
        {order.subject && <p className="m-0 text-body font-medium">{order.subject}</p>}
      </header>

      {status === "open" && (
        <Button size="touch" className="w-full" disabled={start.isPending} onClick={() => start.mutate(undefined)}>{t("app.detail.start")}</Button>
      )}
      {status === "in_progress" && (
        <Button size="touch" className="w-full" disabled={complete.isPending} onClick={() => setConfirming(true)}>{t("app.detail.complete")}</Button>
      )}

      {(address || order.location_note) && (
        <Section title={t("app.detail.address")}>
          {order.customer_name && <p className="m-0 text-body font-medium">{order.customer_name}</p>}
          {address && <p className="m-0 text-body">{address}</p>}
          {order.location_note && <p className="m-0 text-control text-muted-foreground">{order.location_note}</p>}
          {route && (
            <Button asChild variant="secondary" size="touch">
              <a href={route} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" />{t("app.detail.route")}</a>
            </Button>
          )}
        </Section>
      )}

      {contact && (contact.name || contact.phone || contact.mobile || contact.email) && (
        <Section title={t("app.detail.contact")}>
          {contact.name && <p className="m-0 text-body">{contact.name}</p>}
          <div className="flex flex-wrap gap-2">
            {[contact.phone, contact.mobile].filter((n): n is string => !!n).map((n) => (
              <Button key={n} asChild variant="secondary" size="touch">
                <a href={`tel:${n}`}><Phone aria-hidden="true" /><Metric size="body">{n}</Metric></a>
              </Button>
            ))}
            {contact.email && (
              <Button asChild variant="secondary" size="touch">
                <a href={`mailto:${contact.email}`}><Mail aria-hidden="true" />{contact.email}</a>
              </Button>
            )}
          </div>
        </Section>
      )}

      {order.notes && (
        <Section title={t("app.detail.notes")}><p className="m-0 whitespace-pre-wrap text-body">{order.notes}</p></Section>
      )}

      {items.length > 0 && (
        <Section title={t("app.detail.items")}>
          <ul className="m-0 list-none space-y-2 p-0">
            {items.map((i) => (
              <li key={i.position} className="rounded-card border border-border bg-card p-3">
                <p className="m-0 text-body">
                  <Metric size="body">{i.quantity}</Metric> {unitLabel(i.unit)} {i.title}
                </p>
                {i.description && <p className="m-0 text-control text-muted-foreground">{i.description}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {technicians.length > 0 && (
        <Section title={t("app.detail.coTechnicians")}><p className="m-0 text-body">{technicians.join(", ")}</p></Section>
      )}

      <Section title={t("app.detail.reports")}>
        {reports.length === 0 ? <p className="m-0 text-control text-muted-foreground">{t("app.detail.noReports")}</p> : (
          <ul className="m-0 list-none space-y-2 p-0">
            {reports.map((r) => (
              <li key={r.id} className="rounded-card border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body"><Metric size="body">{formatDateWithWeekday(r.visit_date)}</Metric>, {r.technician_name}</span>
                  <StatusPill tone={r.signed_at ? "confirmed" : r.locked_at ? "neutral" : "waiting"}>
                    {r.signed_at ? t("app.detail.reportSigned", { name: r.signer_name ?? "" }) : r.locked_at ? t("app.detail.reportLocked") : t("app.detail.reportOpen")}
                  </StatusPill>
                </div>
                {r.photos.length > 0 && <p className="m-0 mt-1 text-control text-muted-foreground">{t("app.detail.photos", { count: r.photos.length })}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.detail.completeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("app.detail.completeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button disabled={complete.isPending} onClick={onComplete}>{t("app.detail.complete")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Body({ orderId }: { orderId: string }) {
  const { t } = useTranslation("werkbank");
  const qc = useQueryClient();
  const { user, currentOrg } = useAuth();
  const { data, isLoading, isError, error, refetch } = useAssignment(orderId);
  const notAssigned = isError && mapDbError(error) === "errors.notAssigned";

  // The order left this technician's list: drop the cached (and persisted) entry.
  useEffect(() => {
    if (notAssigned) qc.removeQueries({ queryKey: [...ASSIGNMENTS_KEY, user?.id, currentOrg?.id, orderId] });
  }, [notAssigned, qc, user?.id, currentOrg?.id, orderId]);

  if (notAssigned) {
    return (
      <Alert variant="destructive" className="space-y-2">
        <p className="m-0">{t("errors.notAssigned")}</p>
        <Link to={ASSIGNMENTS_PATH} className="inline-flex min-h-11 items-center underline">{t("app.detail.notAssignedBack")}</Link>
      </Alert>
    );
  }
  if (isLoading) return <Skeleton role="status" aria-busy="true" className="h-40 w-full" />;
  if (isError || !data) return <Alert variant="destructive">{t("app.loadFailed")}</Alert>;
  return <Detail orderId={orderId} data={data} refetch={() => refetch()} />;
}

/** One assigned order: facts, the status action, contact, work and read-only visit reports. */
export function AssignmentPage() {
  const { t } = useTranslation("werkbank");
  const { orderId } = useParams<{ orderId: string }>();
  return (
    <MobileShell title={t("app.assignmentTitle")} back={ASSIGNMENTS_PATH}>
      <TechnicianRoute>{orderId && <Body orderId={orderId} />}</TechnicianRoute>
    </MobileShell>
  );
}
