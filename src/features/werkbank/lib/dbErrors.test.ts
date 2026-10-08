import { describe, it, expect } from "vitest";
import { mapDbError, WerkbankDataError } from "./dbErrors";

describe("mapDbError", () => {
  it("maps the customer number unique violation (message)", () => {
    expect(
      mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "customers_customer_no_unique"' }),
    ).toBe("errors.customerNoTaken");
  });

  it("maps the item number unique violation (details)", () => {
    expect(
      mapDbError({ code: "23505", message: "duplicate key", details: "catalog_items_item_no_unique" }),
    ).toBe("errors.itemNoTaken");
  });

  it("maps the item number unique violation (message)", () => {
    expect(
      mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "catalog_items_item_no_unique"' }),
    ).toBe("errors.itemNoTaken");
  });

  it("maps other unique violations to generic", () => {
    expect(mapDbError({ code: "23505", message: 'violates unique constraint "other"' })).toBe("errors.generic");
  });

  it("maps foreign key violations to inUse", () => {
    expect(mapDbError({ code: "23503", message: "fk" })).toBe("errors.inUse");
  });

  it("maps permission errors to forbidden", () => {
    expect(mapDbError({ code: "42501", message: "denied" })).toBe("errors.forbidden");
    expect(mapDbError({ code: "PGRST301", message: "jwt" })).toBe("errors.forbidden");
  });

  it("maps anything else to generic", () => {
    expect(mapDbError({ code: "XX000", message: "x" })).toBe("errors.generic");
    expect(mapDbError(new Error("nope"))).toBe("errors.generic");
    expect(mapDbError(null)).toBe("errors.generic");
    expect(mapDbError("text")).toBe("errors.generic");
  });
});

describe("mapDbError quote and order errors", () => {
  it.each([
    ["quote_locked", "errors.quoteLocked"],
    ["order_locked", "errors.orderLocked"],
    ["property_customer_mismatch", "errors.propertyMismatch"],
    ["invalid_transition", "errors.invalidTransition"],
  ])("maps %s by message", (message, key) => {
    expect(mapDbError({ code: "55000", message })).toBe(key);
  });

  it("maps the order unique violation on the quote", () => {
    expect(mapDbError({ code: "23505", message: 'violates unique constraint "orders_quote_id_key"' })).toBe("errors.orderExists");
  });

  it.each([
    [{ code: "55000", message: "invoice_locked" }, "errors.invoiceLocked"],
    [{ code: "22023", message: "invoice_not_ready", details: "no_items" }, "errors.invoiceNotReady"],
    [{ code: "22023", message: "order_not_done" }, "errors.orderNotDone"],
    [{ code: "55000", message: "number_range_locked" }, "errors.numberRangeLocked"],
    [{ code: "23505", message: 'violates unique constraint "invoices_one_active_per_order"' }, "errors.activeInvoiceExists"],
    [{ code: "23505", message: 'violates unique constraint "invoices_cancels_invoice_id_key"' }, "errors.cancellationExists"],
    [{ code: "22023", message: "invalid_transition" }, "errors.invalidTransition"],
  ])("maps the invoice error %j", (err, key) => {
    expect(mapDbError(err)).toBe(key);
  });

  it.each(["quote_service_only", "order_service_only", "provenance_service_only", "item_reparent"])(
    "maps %s to the generic not-allowed key",
    (message) => {
      expect(mapDbError({ code: "42501", message })).toBe("errors.notAllowedHere");
    },
  );

  it("keeps a plain permission denial as forbidden", () => {
    expect(mapDbError({ code: "42501", message: "denied" })).toBe("errors.forbidden");
  });
});

describe("WerkbankDataError", () => {
  it("is an Error that carries a database-style code", () => {
    const err = new WerkbankDataError("P0001", "invalid_transition");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WerkbankDataError");
    expect(err.code).toBe("P0001");
    expect(err.message).toBe("invalid_transition");
    expect(err.stack).toBeTruthy();
  });
  it("maps like the database error it stands in for", () => {
    expect(mapDbError(new WerkbankDataError("P0001", "invalid_transition"))).toBe("errors.invalidTransition");
  });
});
