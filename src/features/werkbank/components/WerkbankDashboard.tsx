import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrderList } from "../hooks/useOrders";
import { useQuoteList } from "../hooks/useQuotes";
import { needsSchedule } from "../lib/orderStatus";
import { isAcceptedWithoutOrder } from "../lib/quoteStatus";
import { ORDERS_PATH, QUOTES_PATH } from "../paths";
import { StartList } from "./StartList";

/** Two counts the office acts on, each linking to the list with its filter applied. */
function DashboardTiles() {
  const { t } = useTranslation("werkbank");
  const quotes = useQuoteList();
  const orders = useOrderList();
  const count = (n: number | undefined) => (n === undefined ? "–" : String(n));

  return (
    <section aria-label={t("dashboard.tiles.label")} className="grid gap-3 sm:grid-cols-2">
      <Link to={`${QUOTES_PATH}?status=accepted&noOrder=1`} className="block rounded-card hover:bg-hover-tint">
        <KpiTile
          tone="waiting"
          label={t("dashboard.tiles.acceptedNoOrder")}
          value={count(quotes.data?.filter(isAcceptedWithoutOrder).length)}
        />
      </Link>
      <Link to={`${ORDERS_PATH}?unscheduled=1`} className="block rounded-card hover:bg-hover-tint">
        <KpiTile
          tone="waiting"
          label={t("dashboard.tiles.unscheduled")}
          value={count(orders.data?.filter(needsSchedule).length)}
        />
      </Link>
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
