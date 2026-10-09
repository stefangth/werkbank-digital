import { describe, it, expect } from "vitest";
import type { AssignmentRow } from "../data/technicianApp";
import { GROUP_ORDER, groupAssignments, isOfflineGroup } from "./assignments";

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
