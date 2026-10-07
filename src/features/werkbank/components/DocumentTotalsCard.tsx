import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Metric } from "@/components/ui/metric";
import type { DocumentTotals } from "../data/quotes";
import { formatEuro } from "../lib/money";

type VatRow = { rate: number; vat: number };

/** `vat_breakdown` is jsonb: keep only well-formed rows, so a surprising shape renders fewer
 *  rows instead of crashing the page. */
function vatRows(raw: unknown): VatRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is VatRow => !!r && typeof r === "object" && typeof (r as VatRow).rate === "number" && typeof (r as VatRow).vat === "number",
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between font-semibold" : "flex justify-between"}>
      <span>{label}</span>
      <Metric size="body">{value}</Metric>
    </div>
  );
}

/** Net, discount (only above zero), one VAT row per rate, gross; for private customers also the
 *  labour share of the gross amount (§35a EStG). */
export function DocumentTotalsCard({ totals, isPrivateCustomer }: { totals: DocumentTotals | null; isPrivateCustomer: boolean }) {
  const { t, i18n } = useTranslation("werkbank");
  const money = (n: number | null | undefined) => formatEuro(n ?? 0, i18n.language);
  const discount = totals?.discount_total ?? 0;

  return (
    <Card>
      <CardHeader><Eyebrow>{t("totals.title")}</Eyebrow></CardHeader>
      <CardContent className="space-y-1 text-control">
        <Row label={t("totals.net")} value={money(totals?.net_total)} />
        {discount > 0 && <Row label={t("totals.discount")} value={`-${money(discount)}`} />}
        {vatRows(totals?.vat_breakdown).map((r) => (
          <Row key={r.rate} label={t("totals.vat", { rate: r.rate })} value={money(r.vat)} />
        ))}
        <Row label={t("totals.gross")} value={money(totals?.gross_total)} strong />
        {isPrivateCustomer && <Row label={t("totals.labour")} value={money(totals?.labour_total)} />}
      </CardContent>
    </Card>
  );
}
