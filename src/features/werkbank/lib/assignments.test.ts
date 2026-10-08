import { describe, it, expect } from "vitest";
import type { AssignmentRow } from "../data/technicianApp";
import { GROUP_ORDER, groupAssignments, isOfflineGroup, offlineOrderIds, shouldPersistQuery } from "./assignments";

const row = (o: Partial<AssignmentRow>): AssignmentRow => ({
  id: "x", order_no: "A-1", status: "open", scheduled_date: null, scheduled_time: null, subject: null,
  customer_name: null, street: null, postal_code: null, city: null, group_key: "today", ...o,
});

describe("groupAssignments", () => {
  it("orders groups by GROUP_ORDER and drops empty ones", () => {
    const groups = groupAssignments([row({ id: "d", group_key: "done" }), row({ id: "o", group_key: "overdue" }), row({ id: "u", group_key: "unscheduled" })]);
    expect(groups.map((g) => g.key)).toEqual(["overdue", "unscheduled", "done"]);
    expect(GROUP_ORDER).toEqual(["overdue", "today", "upcoming", "unscheduled", "done"]);
  });
  it("sorts rows by date, then time, then order number, undated last", () => {
    const [g] = groupAssignments([
      row({ id: "c", order_no: "A-3", scheduled_date: "2026-10-09", scheduled_time: "09:00:00" }),
      row({ id: "b", order_no: "A-2", scheduled_date: "2026-10-09", scheduled_time: "08:00:00" }),
      row({ id: "a2", order_no: "A-2", scheduled_date: "2026-10-09", scheduled_time: null }),
      row({ id: "a", order_no: "A-1", scheduled_date: "2026-10-08", scheduled_time: "23:00:00" }),
      row({ id: "n", order_no: "A-0", scheduled_date: null }),
    ].map((r) => ({ ...r, group_key: "upcoming" })));
    expect(g.rows.map((r) => r.id)).toEqual(["a", "b", "c", "a2", "n"]);
  });
  it("ignores unknown group keys", () => {
    expect(groupAssignments([row({ group_key: "weird" })])).toEqual([]);
  });
});

describe("isOfflineGroup", () => {
  it("is true for overdue, today and upcoming only", () => {
    expect(GROUP_ORDER.filter(isOfflineGroup)).toEqual(["overdue", "today", "upcoming"]);
  });
});

describe("shouldPersistQuery", () => {
  const ids = offlineOrderIds([
    row({ id: "o", group_key: "overdue" }), row({ id: "t", group_key: "today" }), row({ id: "up", group_key: "upcoming" }),
    row({ id: "un", group_key: "unscheduled" }), row({ id: "d", group_key: "done" }),
  ]);
  const q = (queryKey: unknown[]) => ({ queryKey });
  it("collects the orders of the offline groups", () => {
    expect([...ids].sort()).toEqual(["o", "t", "up"]);
  });
  it("keeps the list and the details of offline groups", () => {
    expect(shouldPersistQuery(q(["werkbank", "assignments", "u1", "org"]), ids, "u1")).toBe(true);
    for (const id of ["o", "t", "up"]) expect(shouldPersistQuery(q(["werkbank", "assignments", "u1", "org", id]), ids, "u1")).toBe(true);
  });
  it("drops done and unscheduled details and every other key", () => {
    expect(shouldPersistQuery(q(["werkbank", "assignments", "u1", "org", "un"]), ids, "u1")).toBe(false);
    expect(shouldPersistQuery(q(["werkbank", "assignments", "u1", "org", "d"]), ids, "u1")).toBe(false);
    expect(shouldPersistQuery(q(["werkbank", "visit-object-urls", "org/o/r/a.jpg"]), ids, "u1")).toBe(false);
    expect(shouldPersistQuery(q(["werkbank", "orders", "org"]), ids, "u1")).toBe(false);
    expect(shouldPersistQuery(q(["werkbank", "technician-orgs", "u1"]), ids, "u1")).toBe(false);
    expect(shouldPersistQuery(q(["bookings", "status"]), ids, "u1")).toBe(false);
  });
  it("drops another user's list and details (shared phone)", () => {
    expect(shouldPersistQuery(q(["werkbank", "assignments", "u2", "org"]), ids, "u1")).toBe(false);
    expect(shouldPersistQuery(q(["werkbank", "assignments", "u2", "org", "o"]), ids, "u1")).toBe(false);
    expect(shouldPersistQuery(q(["werkbank", "assignments", "u1", "org", "o", "extra"]), ids, "u1")).toBe(false);
  });
});
