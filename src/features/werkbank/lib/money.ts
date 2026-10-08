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
    if (!/^([1-9]\d{0,2}(\.\d{3})+|\d+),\d+$/.test(s)) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
    // With a comma every decimal counts: "1,500" is not 1,50.
    if ((normalized.split(".")[1]?.length ?? 0) > 2) return null;
  } else {
    // A leading 0 is never a thousands group: "0.500" is half a euro.
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "");
    else if (/^\d+(\.\d+)?$/.test(s)) {
      normalized = s;
      // Dot decimals only: trailing zeros carry no cents ("0.500" is fine, "0.1234" is not).
      const decimals = s.split(".")[1]?.replace(/0+$/, "");
      if (decimals && decimals.length > 2) return null;
    } else return null;
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}
