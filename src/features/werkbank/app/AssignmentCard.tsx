import { Link } from "react-router-dom";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import { useTranslation } from "react-i18next";
import type { AssignmentRow } from "../data/technicianApp";
import { ORDER_STATUS_TONES, type OrderStatus } from "../lib/orderStatus";
import { assignmentPath } from "../paths";

/** One assignment in the list: a full-width tap target (at least 44 px) linking to the detail. */
export function AssignmentCard({ row }: { row: AssignmentRow }) {
  const { t } = useTranslation("werkbank");
  const address = [row.street, [row.postal_code, row.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const status = row.status as OrderStatus;
  return (
    <Link
      to={assignmentPath(row.id)}
      className="block min-h-11 rounded-card border border-border bg-card p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {row.scheduled_time && <Metric size="body">{row.scheduled_time.slice(0, 5)}</Metric>}
          <Token>{row.order_no}</Token>
        </span>
        <StatusPill tone={ORDER_STATUS_TONES[status] ?? "neutral"}>{t(`orders.status.${status}`)}</StatusPill>
      </div>
      {row.customer_name && <p className="m-0 mt-1 text-body font-medium">{row.customer_name}</p>}
      {address && <p className="m-0 text-control text-muted-foreground">{address}</p>}
      {row.subject && <p className="m-0 mt-1 text-control">{row.subject}</p>}
    </Link>
  );
}
