export type DbErrorKey =
  | "errors.customerNoTaken"
  | "errors.itemNoTaken"
  | "errors.inUse"
  | "errors.forbidden"
  | "errors.generic";

/** Maps a PostgREST/Postgres error to an i18n key in the `werkbank` namespace. */
export function mapDbError(error: unknown): DbErrorKey {
  if (typeof error !== "object" || error === null) return "errors.generic";
  const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
  const text = `${typeof message === "string" ? message : ""} ${typeof details === "string" ? details : ""}`;
  if (code === "23505") {
    if (text.includes("customers_customer_no_unique")) return "errors.customerNoTaken";
    if (text.includes("catalog_items_item_no_unique")) return "errors.itemNoTaken";
    return "errors.generic";
  }
  if (code === "23503") return "errors.inUse";
  if (code === "42501" || code === "PGRST301") return "errors.forbidden";
  return "errors.generic";
}
