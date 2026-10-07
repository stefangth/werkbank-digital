import type { TFunction } from "i18next";
import { MAX_IMPORT_ROWS } from "@/lib/artistImport/parseSheet";
import { normalizeCell } from "./normalizeCell";
import type { ColumnMapping, ImportField, ImportSpecDefinition } from "./types";

export interface ValidatedRows<F> {
  /** `index` is the 0-based index into the sheet rows (sheet row number = index + 2). */
  valid: { index: number; form: F }[];
  invalid: { index: number; messages: string[] }[];
}

/** The country a postal code field is checked against: "billing_postal_code" -> "billing_country_code". */
const countryKeyOf = (field: ImportField) => field.key.replace("postal_code", "country_code");

/** Reads the mapped cells of one row, normalizes them per field kind and fills defaults. Postal
 *  codes run last so they see the row's (normalized, defaulted) country. */
function cellsOf(row: Record<string, string>, mapping: ColumnMapping, fields: ImportField[]): Record<string, string> {
  const values: Record<string, string> = {};
  const ordered = [...fields.filter((f) => f.kind !== "postal_code"), ...fields.filter((f) => f.kind === "postal_code")];
  for (const field of ordered) {
    const column = mapping[field.key];
    const raw = column ? row[column] : undefined;
    const value = normalizeCell(raw, field.kind, values[countryKeyOf(field)]);
    values[field.key] = value === "" && field.defaultValue !== undefined ? field.defaultValue : value;
  }
  return values;
}

/** Validates sheet rows with the spec's schema. Invalid rows carry their schema messages and are
 *  left out of the import. At most MAX_IMPORT_ROWS rows are read; the rest is one invalid entry. */
export function validateRows<F>(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  spec: ImportSpecDefinition<F>,
  t: TFunction,
): ValidatedRows<F> {
  const schema = spec.schema(t);
  const result: ValidatedRows<F> = { valid: [], invalid: [] };
  rows.slice(0, MAX_IMPORT_ROWS).forEach((row, index) => {
    const parsed = schema.safeParse(cellsOf(row, mapping, spec.fields));
    if (parsed.success) result.valid.push({ index, form: parsed.data });
    else result.invalid.push({ index, messages: [...new Set(parsed.error.issues.map((i) => i.message))] });
  });
  if (rows.length > MAX_IMPORT_ROWS) {
    result.invalid.push({ index: MAX_IMPORT_ROWS, messages: [t("import.errors.tooManyRows", { max: MAX_IMPORT_ROWS })] });
  }
  return result;
}
