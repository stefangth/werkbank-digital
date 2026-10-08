/** An euro amount for display in the UI language ("52,50 €" in German, "€52.50" in English).
 *  Werkbank may not import the hire-order `formatMoney` (ESLint, ADR 0013), so this is the
 *  plugin's own formatter. Display only; amounts are never computed from the result. */
export function formatEuro(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale || "de", { style: "currency", currency: "EUR" }).format(amount);
}

/** Parses a German or plain euro input ("1.190,50", "1190,5", "1190.50") to a number. Null for
 *  empty or non-numeric input, more than two decimals, or a value of zero or less. */
export function parseEuroInput(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  let normalized: string;
  if (s.includes(",")) {
    // Comma is the decimal separator, dots are thousands separators.
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(s)) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else {
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    normalized = s;
  }
  const decimals = normalized.split(".")[1];
  if (decimals && decimals.length > 2) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}
