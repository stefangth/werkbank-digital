import type { SupabaseClient } from "@supabase/supabase-js";
import type { TFunction } from "i18next";
import type { ZodType } from "zod";
import type { Database } from "@/integrations/supabase/types";

export type ImportCellKind = "text" | "money" | "postal_code" | "integer" | "enum" | "country" | "vat_id";

/** One importable column of an entity. `required` fields must be mapped to a sheet column before
 *  the review step; `defaultValue` fills a blank or unmapped cell (the same default the database
 *  would use). */
export interface ImportField {
  key: string;
  labelKey: string;
  required: boolean;
  aliases: string[];
  kind: ImportCellKind;
  defaultValue?: string;
}

/** One row of a werkbank import RPC result. `row` is the 0-based index into the rows sent. */
export type ImportResult = {
  row: number;
  status: "created" | "skipped" | "error";
  reason: "customer_no_taken" | "item_no_taken" | "unknown_customer" | "invalid" | null;
  detail: string | null;
};

export type ImportClient = SupabaseClient<Database>;

/** Everything the import dialog needs to know about one entity. */
export interface ImportSpec<F> {
  entity: "customers" | "properties" | "catalog_items";
  fields: ImportField[];
  /** Validates the normalized cells of one row (all strings) into the form type. */
  schema: (t: TFunction) => ZodType<F>;
  toRpcRow: (form: F) => Record<string, unknown>;
  run: (client: ImportClient, orgId: string, rows: Record<string, unknown>[]) => Promise<ImportResult[]>;
}

/** A spec before its RPC call is attached (the import specs in specs.ts; `run` comes from the data layer). */
export type ImportSpecDefinition<F> = Omit<ImportSpec<F>, "run">;

/** Sheet column chosen per field key; `null` when the field is not imported. */
export type ColumnMapping = Record<string, string | null>;
