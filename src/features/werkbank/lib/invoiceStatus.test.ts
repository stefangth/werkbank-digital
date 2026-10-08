import { describe, it, expect } from "vitest";
import { INVOICE_STATUS_TONES, signedGross } from "./invoiceStatus";

describe("invoiceStatus", () => {
  it("maps each status to its tone", () => {
    expect(INVOICE_STATUS_TONES).toEqual({ draft: "neutral", issued: "confirmed", cancelled: "neutral" });
  });
  it("keeps an invoice positive", () => {
    expect(signedGross({ type: "invoice", gross_total: 119 })).toBe(119);
  });
  it("makes a cancellation negative, whatever sign is stored", () => {
    expect(signedGross({ type: "cancellation", gross_total: 119 })).toBe(-119);
    expect(signedGross({ type: "cancellation", gross_total: -119 })).toBe(-119);
  });
  it("treats a missing total as zero", () => {
    expect(signedGross({ type: "invoice", gross_total: null })).toBe(0);
  });
});
