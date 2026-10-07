import type { ColumnMapping, ImportField } from "./types";

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** Lower case, umlauts spelled out, everything but letters and digits dropped:
 *  "Straße" and "Strasse" both become "strasse", "Kundennr." becomes "kundennr". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c])
    .replace(/[^a-z0-9]/g, "");
}

/** Suggests a sheet column per field by matching headers against the field aliases (case, space,
 *  punctuation and umlaut insensitive). Fields are matched in order; each header is used once. */
export function guessColumns(headers: string[], fields: ImportField[]): ColumnMapping {
  const claimed = new Set<string>();
  const mapping: ColumnMapping = {};
  for (const field of fields) {
    const aliases = new Set(field.aliases.map(normalizeHeader));
    const hit = headers.find((h) => !claimed.has(h) && aliases.has(normalizeHeader(h)));
    mapping[field.key] = hit ?? null;
    if (hit !== undefined) claimed.add(hit);
  }
  return mapping;
}
