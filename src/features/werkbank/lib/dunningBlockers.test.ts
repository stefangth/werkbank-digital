import { describe, it, expect } from "vitest";
import { addDaysToKey, dunningBlockers, nextDunningStage, type DunningBlockerInput } from "./dunningBlockers";

const base = (over: Partial<DunningBlockerInput> = {}): DunningBlockerInput => ({
  invoice: { status: "issued", type: "invoice", due_date: "2026-09-01" },
  openAmount: 100, hold: null, notices: [], today: "2026-10-08", ...over,
});
const notice = (over = {}) => ({ stage: 1, pdf_path: "p.pdf", delivery: "email", sent_at: "2026-09-10T10:00:00Z", ...over });

describe("dunningBlockers", () => {
  it("is empty for an overdue issued invoice with an open amount", () => expect(dunningBlockers(base())).toEqual([]));
  it("flags not_issued for a cancelled invoice or a cancellation", () => {
    expect(dunningBlockers(base({ invoice: { status: "cancelled", type: "invoice", due_date: "2026-09-01" } }))).toContain("not_issued");
    expect(dunningBlockers(base({ invoice: { status: "issued", type: "cancellation", due_date: "2026-09-01" } }))).toContain("not_issued");
  });
  it("flags not_overdue on and before the due date, not after", () => {
    expect(dunningBlockers(base({ invoice: { status: "issued", type: "invoice", due_date: "2026-10-08" } }))).toEqual(["not_overdue"]);
    expect(dunningBlockers(base({ invoice: { status: "issued", type: "invoice", due_date: "2026-10-07" } }))).toEqual([]);
  });
  it("flags nothing_open for zero or credit", () => {
    expect(dunningBlockers(base({ openAmount: 0 }))).toEqual(["nothing_open"]);
    expect(dunningBlockers(base({ openAmount: -5 }))).toEqual(["nothing_open"]);
  });
  it("flags on_hold for an open-ended or future hold, not an expired one", () => {
    expect(dunningBlockers(base({ hold: { until: null } }))).toEqual(["on_hold"]);
    expect(dunningBlockers(base({ hold: { until: "2026-10-08" } }))).toEqual(["on_hold"]);
    expect(dunningBlockers(base({ hold: { until: "2026-10-07" } }))).toEqual([]);
  });
  it("flags previous_stage_open for a notice without PDF or an unsent email", () => {
    expect(dunningBlockers(base({ notices: [notice({ pdf_path: null })] }))).toEqual(["previous_stage_open"]);
    expect(dunningBlockers(base({ notices: [notice({ sent_at: null })] }))).toEqual(["previous_stage_open"]);
    expect(dunningBlockers(base({ notices: [notice({ delivery: "print", sent_at: null })] }))).toEqual([]);
  });
  it("flags max_stage once stage 3 exists", () => {
    expect(dunningBlockers(base({ notices: [notice({ stage: 1 }), notice({ stage: 3 })] }))).toEqual(["max_stage"]);
  });
  it("orders the blockers as the tooltip names them", () => {
    const all = dunningBlockers(base({
      invoice: { status: "cancelled", type: "invoice", due_date: "2026-11-01" }, openAmount: 0, hold: { until: null },
      notices: [notice({ stage: 3, pdf_path: null })],
    }));
    expect(all).toEqual(["not_issued", "not_overdue", "nothing_open", "on_hold", "previous_stage_open", "max_stage"]);
  });
});

describe("nextDunningStage and addDaysToKey", () => {
  it("counts up to 3", () => {
    expect(nextDunningStage([])).toBe(1);
    expect(nextDunningStage([{ stage: 1 }])).toBe(2);
    expect(nextDunningStage([{ stage: 1 }, { stage: 2 }, { stage: 3 }])).toBe(3);
  });
  it("adds days across a month end", () => expect(addDaysToKey("2026-10-28", 7)).toBe("2026-11-04"));
});
