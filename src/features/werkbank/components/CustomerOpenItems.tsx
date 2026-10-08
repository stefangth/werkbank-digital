import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert } from "@/components/ui/alert";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { Token } from "@/components/ui/token";
import { useOpenItems } from "../hooks/useOpenItems";
import { formatEuro } from "../lib/money";
import { paymentStatus } from "../lib/paymentStatus";
import { invoicePath } from "../paths";

const cents = (n: number | null) => Math.round((n ?? 0) * 100);

/** What a customer still owes: open total, credit and the invoices behind them. Hidden when the
 *  customer has nothing open and no credit. */
export function CustomerOpenItems({ customerId }: { customerId: string }) {
  const { t, i18n } = useTranslation("werkbank");
  const { data, isLoading, isError } = useOpenItems({ search: "", customerId });
  const money = (n: number) => formatEuro(n, i18n.language);

  if (isLoading) return null;
  if (isError) return <Alert variant="destructive">{t("customers.detail.openItems.loadFailed")}</Alert>;
  if (!data?.length) return null;

  const open = data.reduce((s, r) => s + Math.max(cents(r.open_amount), 0), 0) / 100;
  const credit = data.reduce((s, r) => s + Math.max(-cents(r.open_amount), 0), 0) / 100;

  return (
    <section className="space-y-3" aria-labelledby="customer-open-items">
      <h2 id="customer-open-items" className="m-0 text-lg font-semibold">
        {t("customers.detail.openItems.title")}
      </h2>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <p className="m-0">
          <span className="text-muted-foreground">{t("customers.detail.openItems.open")}</span>{" "}
          <span data-testid="customer-open-total"><Metric size="body" className="font-medium">{money(open)}</Metric></span>
        </p>
        {credit > 0 && (
          <p className="m-0">
            <span className="text-muted-foreground">{t("customers.detail.openItems.credit")}</span>{" "}
            <span data-testid="customer-credit"><Metric size="body" className="font-medium">{money(credit)}</Metric></span>
          </p>
        )}
      </div>
      <ul className="m-0 list-none divide-y divide-border rounded-card border border-border p-0">
        {data.map((r) => {
          const s = paymentStatus(r);
          return (
            <li key={r.invoice_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <Link to={invoicePath(r.invoice_id!)} className="font-medium text-foreground hover:underline">
                <Token>{r.invoice_no}</Token>
              </Link>
              <StatusPill tone={s.tone}>{t(s.labelKey)}</StatusPill>
              <Metric size="body" className="ml-auto">{money(r.open_amount ?? 0)}</Metric>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
