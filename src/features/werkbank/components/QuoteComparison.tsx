import { useTranslation } from "react-i18next";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import type { DocumentItem } from "../data/documentItems";
import { formatEuro } from "../lib/money";
import type { diffAgainstQuote } from "../lib/quoteDiff";

/** "Quote A-0042: x · Order: y · Difference", plus the lines that were changed or added and a
 *  count of quote lines the order no longer has. */
export function QuoteComparison({
  quoteNumber, quoteGross, orderGross, orderItems, diff,
}: {
  quoteNumber: string;
  quoteGross: number;
  orderGross: number;
  orderItems: DocumentItem[];
  diff: ReturnType<typeof diffAgainstQuote>;
}) {
  const { t, i18n } = useTranslation("werkbank");
  const money = (n: number) => formatEuro(n, i18n.language);
  const difference = Math.round((orderGross - quoteGross) * 100) / 100;
  const marked = orderItems.filter((i) => diff.added.has(i.id) || diff.changed.has(i.id));

  return (
    <section className="space-y-2 rounded-card border border-border px-4 py-3 text-sm">
      <p data-testid="comparison-line" className="m-0">
        {t("orders.comparison.quote")} <Token>{quoteNumber}</Token> <Metric size="body">{money(quoteGross)}</Metric>
        {" · "}
        {t("orders.comparison.order")} <Metric size="body">{money(orderGross)}</Metric>
        {" · "}
        {t("orders.comparison.difference")} <Metric size="body">{`${difference > 0 ? "+" : ""}${money(difference)}`}</Metric>
      </p>
      {marked.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {marked.map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <span>{i.name}</span>
              <StatusPill tone={diff.added.has(i.id) ? "accent" : "waiting"}>
                {t(diff.added.has(i.id) ? "orders.comparison.added" : "orders.comparison.changed")}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
      {diff.removedCount > 0 && <p className="m-0 text-muted-foreground">{t("orders.comparison.removed", { count: diff.removedCount })}</p>}
    </section>
  );
}
