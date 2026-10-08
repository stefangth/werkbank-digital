import { describe, it, expect } from "vitest";
import { paymentStatus } from "./paymentStatus";

const row = (payment_state: string, days_overdue = 0, last_stage = 0) => ({ payment_state, days_overdue, last_stage });

describe("paymentStatus", () => {
  it("is neutral while open and not overdue", () => {
    expect(paymentStatus(row("open"))).toEqual({ labelKey: "openItems.state.open", tone: "neutral" });
    expect(paymentStatus(row("partial"))).toEqual({ labelKey: "openItems.state.partial", tone: "neutral" });
  });
  it("is amber when overdue before stage 2", () => {
    expect(paymentStatus(row("open", 3, 0))).toEqual({ labelKey: "openItems.state.overdue", tone: "waiting" });
    expect(paymentStatus(row("partial", 3, 1)).tone).toBe("waiting");
  });
  it("is red from stage 2 while open", () => {
    expect(paymentStatus(row("open", 30, 2))).toEqual({ labelKey: "openItems.state.overdue", tone: "risk" });
    expect(paymentStatus(row("partial", 30, 3)).tone).toBe("risk");
  });
  it("settled states", () => {
    expect(paymentStatus(row("paid", 0, 2))).toEqual({ labelKey: "openItems.state.paid", tone: "confirmed" });
    expect(paymentStatus(row("written_off"))).toEqual({ labelKey: "openItems.state.writtenOff", tone: "confirmed" });
    expect(paymentStatus(row("void"))).toEqual({ labelKey: "openItems.state.void", tone: "neutral" });
    expect(paymentStatus(row("overpaid"))).toEqual({ labelKey: "openItems.state.overpaid", tone: "accent" });
  });
});
