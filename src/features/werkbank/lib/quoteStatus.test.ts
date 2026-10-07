import { describe, it, expect } from "vitest";
import { QUOTE_STATUS_TONE, quoteDisplayStatus } from "./quoteStatus";

describe("quoteDisplayStatus", () => {
  it("derives expired from a sent quote past its validity", () => {
    expect(quoteDisplayStatus({ status: "sent", is_expired: true })).toBe("expired");
    expect(quoteDisplayStatus({ status: "sent", is_expired: false })).toBe("sent");
  });
  it("keeps the stored status for every other status, expired or not", () => {
    for (const s of ["draft", "accepted", "rejected", "superseded"] as const) {
      expect(quoteDisplayStatus({ status: s, is_expired: true })).toBe(s);
    }
  });
  it("maps null values to a draft, not a crash", () => {
    expect(quoteDisplayStatus({ status: null, is_expired: null })).toBe("draft");
  });
  it("tones: draft neutral, sent waiting, accepted confirmed, rejected and expired risk, superseded neutral", () => {
    expect(QUOTE_STATUS_TONE).toEqual({
      draft: "neutral", sent: "waiting", accepted: "confirmed", rejected: "risk", expired: "risk", superseded: "neutral",
    });
  });
});
