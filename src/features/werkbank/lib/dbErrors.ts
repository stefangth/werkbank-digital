export type DbErrorKey =
  | "errors.customerNoTaken"
  | "errors.itemNoTaken"
  | "errors.inUse"
  | "errors.forbidden"
  | "errors.quoteLocked"
  | "errors.orderLocked"
  | "errors.propertyMismatch"
  | "errors.invalidTransition"
  | "errors.orderExists"
  | "errors.invoiceLocked"
  | "errors.invoiceNotReady"
  | "errors.orderNotDone"
  | "errors.numberRangeLocked"
  | "errors.activeInvoiceExists"
  | "errors.cancellationExists"
  | "errors.notAllowedHere"
  | "errors.generic";

/** A client-side failure that stands in for a database error: an Error (stack, instanceof) that
 *  carries a Postgres-style `code`, so mapDbError treats it like the real one. */
export class WerkbankDataError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WerkbankDataError";
    this.code = code;
  }
}

/** Maps a PostgREST/Postgres error to an i18n key in the `werkbank` namespace. */
export function mapDbError(error: unknown): DbErrorKey {
  if (typeof error !== "object" || error === null) return "errors.generic";
  const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
  const text = `${typeof message === "string" ? message : ""} ${typeof details === "string" ? details : ""}`;
  if (code === "23505") {
    if (text.includes("customers_customer_no_unique")) return "errors.customerNoTaken";
    if (text.includes("catalog_items_item_no_unique")) return "errors.itemNoTaken";
    if (text.includes("orders_quote_id_key")) return "errors.orderExists";
    if (text.includes("invoices_one_active_per_order")) return "errors.activeInvoiceExists";
    if (text.includes("invoices_cancels_invoice_id_key")) return "errors.cancellationExists";
    return "errors.generic";
  }
  // The database raises these with a fixed message (and an errcode that is not unique to them).
  if (text.includes("quote_locked")) return "errors.quoteLocked";
  if (text.includes("order_locked")) return "errors.orderLocked";
  if (text.includes("invoice_locked")) return "errors.invoiceLocked";
  if (text.includes("invoice_not_ready")) return "errors.invoiceNotReady";
  if (text.includes("order_not_done")) return "errors.orderNotDone";
  if (text.includes("number_range_locked")) return "errors.numberRangeLocked";
  if (text.includes("property_customer_mismatch")) return "errors.propertyMismatch";
  if (text.includes("invalid_transition")) return "errors.invalidTransition";
  if (/quote_service_only|order_service_only|provenance_service_only|item_reparent/.test(text)) {
    return "errors.notAllowedHere";
  }
  if (code === "23503") return "errors.inUse";
  if (code === "42501" || code === "PGRST301") return "errors.forbidden";
  return "errors.generic";
}
