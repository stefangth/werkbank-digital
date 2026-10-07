import { describe, it, expect } from "vitest";
import { ORDER_STATUS_TONES, nextOrderActions } from "./orderStatus";

describe("orderStatus", () => {
  it("maps each status to its tone", () => {
    expect(ORDER_STATUS_TONES).toEqual({ open: "waiting", in_progress: "accent", done: "confirmed", cancelled: "neutral" });
  });
  it("offers the transitions the database allows", () => {
    expect(nextOrderActions("open")).toEqual(["start", "cancel"]);
    expect(nextOrderActions("in_progress")).toEqual(["complete", "cancel"]);
    expect(nextOrderActions("done")).toEqual(["reopen"]);
    expect(nextOrderActions("cancelled")).toEqual([]);
  });
});
