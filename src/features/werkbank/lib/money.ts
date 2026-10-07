/** An euro amount for display in the UI language ("52,50 €" in German, "€52.50" in English).
 *  Werkbank may not import the hire-order `formatMoney` (ESLint, ADR 0013), so this is the
 *  plugin's own formatter. Display only; amounts are never computed from the result. */
export function formatEuro(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale || "de", { style: "currency", currency: "EUR" }).format(amount);
}
