import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrderList } from "../hooks/useOrders";
import { useQuoteList } from "../hooks/useQuotes";
import { needsSchedule } from "../lib/orderStatus";
import { isAcceptedWithoutOrder } from "../lib/quoteStatus";
import { ORDERS_PATH, QUOTES_PATH } from "../paths";
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
  if (query.isLoading) return <Skeleton className="h-20 w-full" />;
  if (query.isError || !query.data) {
    return <p role="alert" className="m-0 rounded-card bg-card p-[14px] text-sm text-destructive">{t("dashboard.tiles.loadFailed")}</p>;
  }
  return (
    <Link to={to} className="block rounded-card hover:bg-hover-tint">
      <KpiTile tone="waiting" label={label} value={String(count(query.data))} />
    </Link>
  );
}

/** Two counts the office acts on, each linking to the list with its filter applied. */
function DashboardTiles() {
  const { t } = useTranslation("werkbank");
  const quotes = useQuoteList();
  const orders = useOrderList();

  return (
    <section aria-label={t("dashboard.tiles.label")} className="grid gap-3 sm:grid-cols-2">
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
