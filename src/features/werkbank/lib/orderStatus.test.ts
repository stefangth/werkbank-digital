import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ORDER_STATUSES, ORDER_STATUS_TONES, needsSchedule, nextOrderActions } from "./orderStatus";

describe("ORDER_STATUSES", () => {
  it("matches the check constraint on werkbank.orders.status", () => {
    const sql = readFileSync("supabase/migrations/20261007180000_werkbank_quotes_orders.sql", "utf8");
    const check = /status text not null default 'open' check \(status in \(([^)]*)\)\)/.exec(sql);
    expect(check).not.toBeNull();
    const dbValues = check![1].split(",").map((v) => v.trim().replace(/'/g, ""));
    expect([...ORDER_STATUSES]).toEqual(dbValues);
  });
});

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

describe("needsSchedule", () => {
  it("is true for an open or running order without a date", () => {
    expect(needsSchedule({ status: "open", scheduled_date: null })).toBe(true);
    expect(needsSchedule({ status: "in_progress", scheduled_date: null })).toBe(true);
  });
  it("is false with a date, or once done or cancelled", () => {
    expect(needsSchedule({ status: "open", scheduled_date: "2026-11-03" })).toBe(false);
    expect(needsSchedule({ status: "done", scheduled_date: null })).toBe(false);
    expect(needsSchedule({ status: "cancelled", scheduled_date: null })).toBe(false);
  });
});
