import type { ImportCellKind } from "./types";

/** German labels, English words and the codes themselves, keyed as `enumKey` spells them. */
const ENUM_CODES: Record<string, string> = {
  // customer kind
  hausverwaltung: "property_manager",
  hv: "property_manager",
  propertymanager: "property_manager",
  privat: "private",
  private: "private",
  privatkunde: "private",
  // units (DE labels of units.* plus common spellings)
  std: "HUR",
  stunde: "HUR",
  stunden: "HUR",
  h: "HUR",
  hur: "HUR",
  stk: "H87",
  stck: "H87",
  stueck: "H87",
  pc: "H87",
  pcs: "H87",
  h87: "H87",
  m: "MTR",
  meter: "MTR",
  mtr: "MTR",
  "m²": "MTK",
  m2: "MTK",
  qm: "MTK",
  mtk: "MTK",
  "m³": "MTQ",
  m3: "MTQ",
  cbm: "MTQ",
  mtq: "MTQ",
  kg: "KGM",
  kgm: "KGM",
  l: "LTR",
  liter: "LTR",
  ltr: "LTR",
  pauschal: "LS",
  psch: "LS",
  lumpsum: "LS",
  ls: "LS",
};

const enumKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/ü/g, "ue")
    .replace(/[\s._%-]/g, "");

/** Country names and one-letter car codes for the countries the forms offer, keyed like `countryKey`. */
const COUNTRY_CODES: Record<string, string> = {
  deutschland: "DE",
  germany: "DE",
  d: "DE",
  oesterreich: "AT",
  austria: "AT",
  a: "AT",
  schweiz: "CH",
  switzerland: "CH",
};

const countryKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/ö/g, "oe")
    .replace(/[^a-z]/g, "");

/** "de", "Deutschland", "Germany" and "D" become "DE" (likewise AT and CH); any other two-letter
 *  code is uppercased. Anything else passes through for the schema to reject. */
function normalizeCountry(text: string): string {
  const key = countryKey(text);
  const code = COUNTRY_CODES[key];
  if (code) return code;
  return /^[a-z]{2}$/i.test(text) ? text.toUpperCase() : text;
}

/** Excel stores a cell formatted as "19 %" as 0.19. Only 19, 7 and 0 are valid rates, so 0.19 and
 *  0.07 are unambiguous. */
const PERCENT_CELLS: Record<string, string> = { "0.19": "19", "0.07": "7" };

function normalizeEnum(text: string): string {
  const code = ENUM_CODES[enumKey(text)];
  if (code) return code;
  const percent = PERCENT_CELLS[text.replace(",", ".")];
  if (percent) return percent;
  // VAT rates: "19 %", "19,00", "19.0", 19
  const rate = /^(\d+)(?:[.,]0+)?\s*%?$/.exec(text);
  return rate ? String(Number(rate[1])) : text;
}

/** "12,50", "12.5", "1.234,50" and "12,50 €" become "12.50" and "1234.50". Ambiguous or
 *  malformed input ("1.234", "1,234", "-1", "abc") is returned with only the comma turned into a
 *  dot, so the schema rejects it instead of the import guessing a different amount. */
function normalizeMoney(text: string): string {
  let s = text.replace(/€/g, "").replace(/\s/g, "");
  if (s === "") return "";
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, ""); // German thousands separators
  }
  s = s.replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s).toFixed(2) : s;
}

/** Turns one sheet cell into the string the zod schemas expect. parseSheet delivers strings, but
 *  numbers (straight from an Excel cell) are handled the same way. */
export function normalizeCell(value: unknown, kind: ImportCellKind, countryCode?: string): string {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  switch (kind) {
    case "money":
      return typeof value === "number" ? value.toFixed(2) : normalizeMoney(text);
    case "postal_code":
      // Excel stores 01067 as the number 1067
      return countryCode?.trim().toUpperCase() === "DE" && /^\d{1,4}$/.test(text) ? text.padStart(5, "0") : text;
    case "integer":
      return /^\d+\.0+$/.test(text) ? text.replace(/\.0+$/, "") : text;
    case "enum":
      return normalizeEnum(text);
    case "country":
      return normalizeCountry(text);
    case "vat_id":
      return text.replace(/\s/g, "").toUpperCase();
    case "text":
      return text;
  }
}
