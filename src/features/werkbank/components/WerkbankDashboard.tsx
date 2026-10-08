import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/AuthContext";
import { useDunningDue, useOpenItems } from "../hooks/useOpenItems";
import { useOrderList } from "../hooks/useOrders";
import { useQuoteList } from "../hooks/useQuotes";
import { needsSchedule } from "../lib/orderStatus";
import { isAcceptedWithoutOrder } from "../lib/quoteStatus";
import { ORDERS_PATH, OPEN_ITEMS_PATH, QUOTES_PATH } from "../paths";
import { StartList } from "./StartList";

/** One count tile: a skeleton while loading, a short error text on failure, else a link to the
 *  list with its filter applied. */
function Tile<Row>({
  to, label, query, count,
}: {
  to: string;
  label: string;
  query: { data: Row[] | undefined; isLoading: boolean; isError: boolean };
  count: (rows: Row[]) => number;
}) {
  const { t } = useTranslation("werkbank");
  if (query.isError) return <Alert variant="destructive">{t("dashboard.tiles.loadFailed")}</Alert>;
  // Loading, or not fetched yet (a disabled query): never an error.
  if (query.isLoading || !query.data) return <Skeleton role="status" aria-busy="true" aria-label={label} className="h-20 w-full" />;
  return (
    <Link to={to} className="block rounded-card hover:bg-hover-tint">
      <KpiTile tone="waiting" label={label} value={String(count(query.data))} />
    </Link>
  );
}

/** Overdue invoices, with how many of them are due a notice; links to the open items page. */
function OverdueTile() {
  const { t } = useTranslation("werkbank");
  const overdue = useOpenItems({ search: "", overdueOnly: true });
  const due = useDunningDue();
  const label = t("dashboard.tiles.overdue");
  if (overdue.isError || due.isError) return <Alert variant="destructive">{t("dashboard.tiles.loadFailed")}</Alert>;
  if (!overdue.data || !due.data) return <Skeleton role="status" aria-busy="true" aria-label={label} className="h-20 w-full" />;
  return (
    <Link to={OPEN_ITEMS_PATH} className="block rounded-card hover:bg-hover-tint">
      <KpiTile
        tone="waiting"
        label={label}
        value={String(overdue.data.length)}
        note={t("dashboard.tiles.overdueNote", { count: due.data.length })}
      />
    </Link>
  );
}

/** Three counts the office acts on, each linking to the list with its filter applied. */
function DashboardTiles() {
  const { t } = useTranslation("werkbank");
  const quotes = useQuoteList();
  const orders = useOrderList();

  return (
    <section aria-label={t("dashboard.tiles.label")} className="grid gap-3 sm:grid-cols-3">
      <Tile
        to={`${QUOTES_PATH}?status=accepted&noOrder=1`}
        label={t("dashboard.tiles.acceptedNoOrder")}
        query={quotes}
        count={(rows) => rows.filter(isAcceptedWithoutOrder).length}
      />
      <Tile
        to={`${ORDERS_PATH}?unscheduled=1`}
        label={t("dashboard.tiles.unscheduled")}
        query={orders}
        count={(rows) => rows.filter(needsSchedule).length}
      />
      <OverdueTile />
    </section>
  );
}

/** Landing page of a handwerk org. Office roles get the tiles and the start list; technicians
 *  see the welcome only. */
export function WerkbankDashboard() {
  const { t } = useTranslation("werkbank");
  const { hasRole, currentOrg } = useAuth();
  const canManage = hasRole("admin") || hasRole("producer");

  return (
    <div className="space-y-6">
      <PageHeader title={t("dashboard.title")} sub={t("dashboard.body")} />
      {canManage && <DashboardTiles />}
      {canManage && <StartList orgId={currentOrg?.id} />}
    </div>
  );
}
